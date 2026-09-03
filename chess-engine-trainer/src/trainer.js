"use strict";
// Fresh trainer: SPSA self-play + Texel-style supervised tuning + SPRT. No imports from old project.
function makeTrainer(engine) {
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randn(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function newBrain() {
    return { version: 2, gen: 0, games: 0, w: 0, l: 0, d: 0, theta: Array.from(engine.defaultTheta()) };
  }
  function cloneTheta(th) { return th.slice(); }

  function clipTheta(th) {
    for (var i = 0; i < 5; i++) th[i] = Math.max(20, Math.min(1500, th[i]));
    for (var j = 5; j < 453; j++) th[j] = Math.max(-160, Math.min(160, th[j]));
    var lo = [-20, 0, 0, 0, 0, 0, -10, -20, 0, 0], hi = [90, 50, 50, 90, 70, 40, 35, 40, 15, 50];
    for (var s = 0; s < 10; s++) th[453 + s] = Math.max(lo[s], Math.min(hi[s], th[453 + s]));
    return th;
  }

  function insufficient(pos) {
    var minors = [], hasMajor = false;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 136) { sq += 7; continue; }
      var p = pos.b[sq];
      if (!p) continue;
      var a = p > 0 ? p : -p;
      if (a === 6) continue;
      if (a === 1 || a === 4 || a === 5) { hasMajor = true; break; }
      minors.push({ dark: (((sq >> 4) + (sq & 7)) & 1) === 1, bishop: a === 3 });
    }
    if (hasMajor) return false;
    if (minors.length <= 1) return true;
    for (var i = 0; i < minors.length; i++) if (!minors[i].bishop) return false;
    var d0 = minors[0].dark;
    for (var j = 1; j < minors.length; j++) if (minors[j].dark !== d0) return false;
    return true;
  }

  function playGame(whiteTh, blackTh, opts) {
    opts = opts || {};
    var depth = opts.depth || 2, maxPlies = opts.maxPlies || 120;
    var openPlies = opts.openPlies != null ? opts.openPlies : 6;
    var rng = opts.rng || mulberry32(1234);
    var pos = engine.startPos();
    var seen = {}, rep = 0;
    var plies = 0;
    var wT = Float64Array.from(whiteTh), bT = Float64Array.from(blackTh);
    while (true) {
      var moves = engine.legalMoves(pos);
      if (!moves.length) {
        if (engine.inCheck(pos, pos.turn)) return { result: pos.turn === engine.WHITE ? "b" : "w", plies: plies, reason: "mate" };
        return { result: "d", plies: plies, reason: "stalemate" };
      }
      if (insufficient(pos)) return { result: "d", plies: plies, reason: "material" };
      if (pos.half >= 100) return { result: "d", plies: plies, reason: "fifty" };
      var key = engine.getFen(pos).split(" ").slice(0, 3).join(" ");
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] >= 3) return { result: "d", plies: plies, reason: "repetition" };
      if (plies >= maxPlies) {
        var e = engine.evaluate(pos, pos.turn === engine.WHITE ? wT : bT);
        if (Math.abs(e) < 120) return { result: "d", plies: plies, reason: "ply-limit" };
        // winner = side ahead: convert side-to-move score to white perspective
        var whiteAhead = pos.turn === engine.WHITE ? e > 0 : e < 0;
        return { result: whiteAhead ? "w" : "b", plies: plies, reason: "adjudicated" };
      }
      var mv;
      if (plies < openPlies) mv = moves[(rng() * moves.length) | 0];
      else {
        var th = pos.turn === engine.WHITE ? wT : bT;
        var r = engine.think(pos, th, { depth: depth });
        mv = r && r.move ? r.move : moves[0];
      }
      engine.doMove(pos, mv);
      plies++;
    }
  }

  // One SPSA iteration: perturb, play 2-sided games, update in place. Returns stats.
  function spsaIter(brain, opts) {
    opts = opts || {};
    var rng = opts.rng || mulberry32((Math.random() * 4294967295) >>> 0);
    var k = (opts.k != null ? opts.k : brain.gen + 1);
    var games = opts.gamesPerIter || 16;
    var depth = opts.depth || 2;
    // Stockfish-style schedule
    var A = opts.A != null ? opts.A : 40, alpha = 0.602, gamma = 0.101;
    var a0 = opts.a0 != null ? opts.a0 : 2.5, c0 = opts.c0 != null ? opts.c0 : 9;
    var ak = a0 / Math.pow(A + k, alpha), ck = c0 / Math.pow(k, gamma);
    var n = engine.N_PARAMS;
    var delta = new Int8Array(n);
    for (var i = 0; i < n; i++) delta[i] = rng() < 0.5 ? -1 : 1;
    var thPlus = brain.theta.slice(), thMinus = brain.theta.slice();
    for (var j = 0; j < n; j++) { thPlus[j] += ck * delta[j]; thMinus[j] -= ck * delta[j]; }
    clipTheta(thPlus); clipTheta(thMinus);
    var score = 0, w = 0, l = 0, d = 0, pliesSum = 0;
    for (var g = 0; g < games; g++) {
      var plusWhite = g % 2 === 0;
      var res = playGame(plusWhite ? thPlus : thMinus, plusWhite ? thMinus : thPlus,
        { depth: depth, maxPlies: opts.maxPlies || 120, openPlies: opts.openPlies != null ? opts.openPlies : 6, rng: rng });
      pliesSum += res.plies;
      var plusScore = res.result === "d" ? 0.5 : ((res.result === "w") === plusWhite ? 1 : 0);
      score += plusScore;
      if (plusScore === 1) { w++; } else if (plusScore === 0) { l++; } else { d++; }
    }
    var grad = (score / games - 0.5) * 2; // [-1, +1]: positive means plus-side better
    // Proper SPSA: ghat = (y+ - y-) / (2*ck*Delta), Delta=+-1, then theta += ak*ghat*Delta
    var scale = ak * grad / (2 * ck);
    for (var u = 0; u < n; u++) brain.theta[u] += scale * delta[u];
    clipTheta(brain.theta);
    brain.gen++; brain.games += games;
    // credit wins to brain record from plus perspective is noisy; track raw
    brain.w += w; brain.l += l; brain.d += d;
    var elo = 0;
    var s = score / games;
    if (s > 0.001 && s < 0.999) elo = -400 * Math.log10(1 / s - 1);
    return { k: k, score: score, games: games, w: w, l: l, d: d, eloPlus: elo, ak: ak, ck: ck, avgPlies: Math.round(pliesSum / Math.max(1, games)) };
  }

  // Parallel SPSA iteration: same perturb/update math as spsaIter, but the
  // games run on a worker-thread pool. Per-game RNG seeds are drawn upfront
  // from the main rng so the stream stays deterministic for a given seed.
  // Falls back to the sequential loop when pool is null (threads <= 1).
  function spsaIterParallel(brain, opts, pool) {
    opts = opts || {};
    if (!pool || typeof pool.runGames !== "function") return Promise.resolve(spsaIter(brain, opts));
    var rng = opts.rng || mulberry32((Math.random() * 4294967295) >>> 0);
    var k = (opts.k != null ? opts.k : brain.gen + 1);
    var games = opts.gamesPerIter || 16;
    var depth = opts.depth || 2;
    var maxPlies = opts.maxPlies || 120;
    var openPlies = opts.openPlies != null ? opts.openPlies : 6;
    var A = opts.A != null ? opts.A : 40, alpha = 0.602, gamma = 0.101;
    var a0 = opts.a0 != null ? opts.a0 : 2.5, c0 = opts.c0 != null ? opts.c0 : 9;
    var ak = a0 / Math.pow(A + k, alpha), ck = c0 / Math.pow(k, gamma);
    var n = engine.N_PARAMS;
    var delta = new Int8Array(n);
    for (var i = 0; i < n; i++) delta[i] = rng() < 0.5 ? -1 : 1;
    var thPlus = brain.theta.slice(), thMinus = brain.theta.slice();
    for (var j = 0; j < n; j++) { thPlus[j] += ck * delta[j]; thMinus[j] -= ck * delta[j]; }
    clipTheta(thPlus); clipTheta(thMinus);
    var jobs = new Array(games);
    for (var g = 0; g < games; g++) {
      jobs[g] = {
        thPlus: thPlus, thMinus: thMinus, plusWhite: g % 2 === 0,
        depth: depth, maxPlies: maxPlies, openPlies: openPlies,
        seed: (rng() * 4294967296) >>> 0
      };
    }
    return pool.runGames(jobs).then(function (results) {
      var score = 0, w = 0, l = 0, d = 0, pliesSum = 0;
      for (var q = 0; q < results.length; q++) {
        var ps = results[q].plusScore;
        score += ps; pliesSum += results[q].plies;
        if (ps === 1) { w++; } else if (ps === 0) { l++; } else { d++; }
      }
      var grad = (score / games - 0.5) * 2;
      var scale = ak * grad / (2 * ck);
      for (var u = 0; u < n; u++) brain.theta[u] += scale * delta[u];
      clipTheta(brain.theta);
      brain.gen++; brain.games += games;
      brain.w += w; brain.l += l; brain.d += d;
      var elo = 0;
      var s = score / games;
      if (s > 0.001 && s < 0.999) elo = -400 * Math.log10(1 / s - 1);
      return { k: k, score: score, games: games, w: w, l: l, d: d, eloPlus: elo, ak: ak, ck: ck, avgPlies: Math.round(pliesSum / Math.max(1, games)) };
    });
  }

  // Texel-style supervised tune on [{fen, result}] result in {1,0.5,0} from white perspective.
  function texelTune(thetaIn, dataset, opts) {
    opts = opts || {};
    var lr = opts.lr != null ? opts.lr : 0.6, epochs = opts.epochs || 4;
    var K = opts.K != null ? opts.K : 0.006;
    var rng = opts.rng || mulberry32(99);
    var th = thetaIn.slice();
    var n = engine.N_PARAMS;
    for (var ep = 0; ep < epochs; ep++) {
      // shuffle
      for (var i = dataset.length - 1; i > 0; i--) { var j = (rng() * (i + 1)) | 0; var t = dataset[i]; dataset[i] = dataset[j]; dataset[j] = t; }
      // Per-epoch SPSA finite-difference step on the logistic loss over a probe subset (fast in JS).
      var probe = dataset.slice(0, Math.min(400, dataset.length));
      function loss(tt) {
        var w = Float64Array.from(tt), sum = 0;
        for (var q = 0; q < probe.length; q++) {
          var pp = engine.setFen(engine.newPos(), probe[q].fen);
          var s2 = engine.evaluate(pp, w);
          var ws = pp.turn === engine.WHITE ? s2 : -s2;
          var sg = 1 / (1 + Math.pow(10, -K * ws));
          var e2 = sg - probe[q].result;
          sum += e2 * e2;
        }
        return sum / probe.length;
      }
      var dir = new Int8Array(n);
      for (var u = 0; u < n; u++) dir[u] = rng() < 0.5 ? -1 : 1;
      var step = 1.2 / (1 + ep);
      var tp = th.slice(), tm = th.slice();
      for (var v = 0; v < n; v++) { tp[v] += step * dir[v]; tm[v] -= step * dir[v]; }
      clipTheta(tp); clipTheta(tm);
      var lp = loss(tp), lm = loss(tm);
      var g = (lp - lm) / 2;
      for (var wI = 0; wI < n; wI++) th[wI] -= lr * g * dir[wI] * 0.05;
      clipTheta(th);
    }
    return th;
  }

  function buildDataset(nGames, depth, seed) {
    var rng = mulberry32(seed || 7);
    var base = Array.from(engine.defaultTheta());
    var out = [];
    for (var g = 0; g < nGames; g++) {
      var res = playGame(base, base, { depth: depth || 1, maxPlies: 100, openPlies: 8, rng: rng });
      // record final result applied to a few quiet sample positions from a fresh random walk
      var p2 = engine.startPos();
      var seq = 6 + ((rng() * 10) | 0);
      for (var i = 0; i < seq; i++) {
        var lm = engine.legalMoves(p2);
        if (!lm.length) break;
        engine.doMove(p2, lm[(rng() * lm.length) | 0]);
      }
      var r = res.result === "d" ? 0.5 : res.result === "w" ? 1 : 0;
      out.push({ fen: engine.getFen(p2), result: r });
    }
    return out;
  }

  function eloDiff(score) {
    if (score <= 0 || score >= 1) return score <= 0 ? -800 : 800;
    return -400 * Math.log10(1 / score - 1);
  }

  // SPRT log-likelihood ratio for win/loss/draw counts (draws worth 0.5)
  function sprtLLR(w, l, d, elo0, elo1) {
    var N = w + l + d;
    if (!N) return 0;
    var s0 = 1 / (1 + Math.pow(10, -elo0 / 400)), s1 = 1 / (1 + Math.pow(10, -elo1 / 400));
    var s = (w + d / 2) / N;
    if (s <= 0 || s >= 1) return 0;
    function ll(p) { return w * Math.log(p) + l * Math.log(1 - p) + d * Math.log(0.5); }
    void ll;
    // trinomial approx via score
    var v = (w * Math.pow(1 - s, 2) + l * Math.pow(s, 2) + d * Math.pow(0.5 - s, 2)) / N;
    if (v <= 0) return 0;
    var llr = N * ((s1 - s0) * (s - (s0 + s1) / 2)) / v;
    return llr;
  }

  function saveBrain(brain) { return JSON.stringify({ version: 2, gen: brain.gen, games: brain.games, w: brain.w, l: brain.l, d: brain.d, theta: brain.theta }); }
  function loadBrain(json) {
    var o = typeof json === "string" ? JSON.parse(json) : json;
    var b = newBrain();
    b.gen = o.gen || 0; b.games = o.games || 0; b.w = o.w || 0; b.l = o.l || 0; b.d = o.d || 0;
    if (o.theta && o.theta.length === engine.N_PARAMS) b.theta = o.theta.slice();
    return b;
  }

  return { mulberry32: mulberry32, randn: randn, newBrain: newBrain, cloneTheta: cloneTheta, clipTheta: clipTheta, playGame: playGame, spsaIter: spsaIter, spsaIterParallel: spsaIterParallel, texelTune: texelTune, buildDataset: buildDataset, eloDiff: eloDiff, sprtLLR: sprtLLR, saveBrain: saveBrain, loadBrain: loadBrain };
}

if (typeof module !== "undefined" && module.exports) module.exports = { makeTrainer: makeTrainer };
if (typeof globalThis !== "undefined") globalThis.FreshTrainer = { makeTrainer: makeTrainer };
