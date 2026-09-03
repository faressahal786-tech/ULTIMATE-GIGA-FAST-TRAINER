"use strict";
// Fresh standalone chess engine — no imports from chess-trainer/.
// Design: 0x88 board, signed pieces (white +, black -), int moves, tapered eval, alpha-beta search.
function makeEngine() {
  var WHITE = 1, BLACK = -1;
  var EMPTY = 0;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

  var N_OFF = [31, 33, 14, 18, -31, -33, -14, -18];
  var K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
  var B_DIR = [15, 17, -15, -17];
  var R_DIR = [1, -1, 16, -16];

  var F_DBL = 1, F_EP = 2, F_CASTLE = 4, F_PROMO = 8;
  var MATE = 100000, INF = 1000000;

  // ---- move encoding (fresh layout, distinct from old project) ----
  // bits: from[0..7] to[8..15] pieceIdx[16..19] capIdx[20..23] promo[24..26] flags[28..31]
  function encMove(f, t, p, c, pr, fl) {
    return (f & 255) | ((t & 255) << 8) | (((p + 7) & 15) << 16) | (((c + 7) & 15) << 20) | ((pr & 7) << 24) | ((fl & 15) << 28);
  }
  function mf(m) { return m & 255; }
  function mt(m) { return (m >>> 8) & 255; }
  function mp(m) { return ((m >>> 16) & 15) - 7; }
  function mc(m) { return ((m >>> 20) & 15) - 7; }
  function mpr(m) { return (m >>> 24) & 7; }
  function mfl(m) { return (m >>> 28) & 15; }
  function onBoard(sq) { return !(sq & 136); }

  function newPos() {
    return { b: new Int8Array(128), turn: WHITE, castling: 0, ep: -1, half: 0, full: 1, kw: 0, kb: 0, h: 0, stack: [] };
  }

  // Incremental Zobrist hashing (maintained in doMove/undoMove; replaces per-node board scan).
  var _z = 0x2545F491;
  function zr() { _z ^= _z << 13; _z >>>= 0; _z ^= _z >>> 17; _z ^= _z << 5; _z >>>= 0; return _z | 0; }
  var ZP = new Int32Array(14 * 128), ZC = new Int32Array(16), ZEP = new Int32Array(8);
  for (var _zi = 0; _zi < ZP.length; _zi++) ZP[_zi] = zr();
  for (var _zj = 0; _zj < 16; _zj++) ZC[_zj] = zr();
  for (var _zk = 0; _zk < 8; _zk++) ZEP[_zk] = zr();
  var ZSIDE = zr();
  function zPiece(p, sq) { return ZP[(p + 7) * 128 + sq]; }

  var FILES = "abcdefgh";
  function sqName(sq) { return FILES[sq & 7] + (((sq >> 4) & 7) + 1); }
  function parseSq(s) { return (s.charCodeAt(0) - 97) + ((s.charCodeAt(1) - 49) * 16); }

  function setFen(pos, fen) {
    pos.b.fill(0); pos.stack.length = 0;
    var parts = fen.trim().split(/\s+/);
    var rows = parts[0].split("/");
    if (rows.length !== 8) throw new Error("bad fen");
    var cmap = { p: -1, n: -2, b: -3, r: -4, q: -5, k: -6, P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6 };
    for (var i = 0; i < 8; i++) {
      var file = 0, rank = 7 - i;
      var row = rows[i];
      for (var k = 0; k < row.length; k++) {
        var ch = row[k];
        if (ch >= "1" && ch <= "8") { file += +ch; continue; }
        var pc = cmap[ch];
        if (!pc) throw new Error("bad fen char " + ch);
        var sq = rank * 16 + file;
        pos.b[sq] = pc;
        if (pc === 6) pos.kw = sq;
        if (pc === -6) pos.kb = sq;
        file++;
      }
    }
    pos.turn = parts[1] === "b" ? BLACK : WHITE;
    pos.castling = 0;
    var cr = parts[2] || "-";
    if (cr.indexOf("K") >= 0) pos.castling |= 1;
    if (cr.indexOf("Q") >= 0) pos.castling |= 2;
    if (cr.indexOf("k") >= 0) pos.castling |= 4;
    if (cr.indexOf("q") >= 0) pos.castling |= 8;
    pos.ep = parts[3] && parts[3] !== "-" ? parseSq(parts[3]) : -1;
    pos.half = parts[4] !== undefined ? +parts[4] : 0;
    pos.full = parts[5] !== undefined ? +parts[5] : 1;
    pos.h = 0;
    for (var _hs = 0; _hs < 128; _hs++) {
      if (_hs & 136) { _hs += 7; continue; }
      var _hp = pos.b[_hs];
      if (_hp) pos.h ^= zPiece(_hp, _hs);
    }
    pos.h ^= ZC[pos.castling];
    if (pos.ep >= 0) pos.h ^= ZEP[pos.ep & 7];
    if (pos.turn === BLACK) pos.h ^= ZSIDE;
    return pos;
  }

  function getFen(pos) {
    var rows = [];
    for (var i = 0; i < 8; i++) {
      var rank = 7 - i, row = "", empty = 0;
      for (var f = 0; f < 8; f++) {
        var pc = pos.b[rank * 16 + f];
        if (!pc) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += pc > 0 ? "PNBRQK"[pc - 1] : "pnbrqk"[-pc - 1];
      }
      if (empty) row += empty;
      rows.push(row);
    }
    var cr = "";
    if (pos.castling & 1) cr += "K";
    if (pos.castling & 2) cr += "Q";
    if (pos.castling & 4) cr += "k";
    if (pos.castling & 8) cr += "q";
    return rows.join("/") + " " + (pos.turn === WHITE ? "w" : "b") + " " + (cr || "-") + " " + (pos.ep >= 0 ? sqName(pos.ep) : "-") + " " + pos.half + " " + pos.full;
  }

  function startPos() { return setFen(newPos(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); }

  function attacked(pos, sq, by) {
    var b = pos.b;
    if (by === WHITE) {
      if (onBoard(sq - 15) && b[sq - 15] === 1) return true;
      if (onBoard(sq - 17) && b[sq - 17] === 1) return true;
    } else {
      if (onBoard(sq + 15) && b[sq + 15] === -1) return true;
      if (onBoard(sq + 17) && b[sq + 17] === -1) return true;
    }
    for (var i = 0; i < 8; i++) { var t = sq + N_OFF[i]; if (onBoard(t) && b[t] === by * 2) return true; }
    for (var j = 0; j < 8; j++) { var u = sq + K_OFF[j]; if (onBoard(u) && b[u] === by * 6) return true; }
    for (var d = 0; d < 4; d++) {
      var s = sq + B_DIR[d];
      while (onBoard(s)) { var p = b[s]; if (p) { if (p === by * 3 || p === by * 5) return true; break; } s += B_DIR[d]; }
    }
    for (var e = 0; e < 4; e++) {
      var v = sq + R_DIR[e];
      while (onBoard(v)) { var q = b[v]; if (q) { if (q === by * 4 || q === by * 5) return true; break; } v += R_DIR[e]; }
    }
    return false;
  }

  function inCheck(pos, color) { return attacked(pos, color === WHITE ? pos.kw : pos.kb, color === WHITE ? BLACK : WHITE); }

  function addPawnMoves(out, f, t, p, cap, promoRank) {
    if ((t >> 4) === promoRank) {
      out.push(encMove(f, t, p, cap, 5, F_PROMO));
      out.push(encMove(f, t, p, cap, 4, F_PROMO));
      out.push(encMove(f, t, p, cap, 3, F_PROMO));
      out.push(encMove(f, t, p, cap, 2, F_PROMO));
    } else out.push(encMove(f, t, p, cap, 0, 0));
  }

  // pseudo-legal generation; capsOnly=true for quiescence
  function genMoves(pos, capsOnly) {
    var out = [], b = pos.b, us = pos.turn, them = -us;
    var promoRank = us === WHITE ? 7 : 0, startRank = us === WHITE ? 1 : 6, dir = us === WHITE ? 16 : -16;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 136) { sq += 7; continue; }
      var p = b[sq];
      if (!p || (p > 0 ? WHITE : BLACK) !== us) continue;
      var at = p > 0 ? p : -p;
      if (at === 1) {
        var one = sq + dir;
        if (onBoard(one) && !b[one]) {
          if (!capsOnly) {
            addPawnMoves(out, sq, one, p, 0, promoRank);
            if ((sq >> 4) === startRank) {
              var two = sq + dir * 2;
              if (!b[two]) out.push(encMove(sq, two, p, 0, 0, F_DBL));
            }
          } else if ((one >> 4) === promoRank) addPawnMoves(out, sq, one, p, 0, promoRank);
        }
        for (var k = 0; k < 2; k++) {
          var to = sq + dir + (k ? 1 : -1);
          if (!onBoard(to)) continue;
          var q = b[to];
          if (q && (q > 0 ? WHITE : BLACK) === them) addPawnMoves(out, sq, to, p, q, promoRank);
          else if (!q && to === pos.ep) out.push(encMove(sq, to, p, them * 1, 0, F_EP));
        }
      } else if (at === 2 || at === 6) {
        var offs = at === 2 ? N_OFF : K_OFF;
        for (var i = 0; i < 8; i++) {
          var dst = sq + offs[i];
          if (!onBoard(dst)) continue;
          var r = b[dst];
          if (r && (r > 0 ? WHITE : BLACK) === us) continue;
          if (capsOnly && !r) continue;
          out.push(encMove(sq, dst, p, r, 0, 0));
        }
        if (at === 6 && !capsOnly) {
          var home = us === WHITE ? 4 : 116;
          if (sq === home) {
            if (us === WHITE) {
              if ((pos.castling & 1) && !b[5] && !b[6] && b[7] === 4 && !attacked(pos, 4, them) && !attacked(pos, 5, them))
                out.push(encMove(4, 6, 6, 0, 0, F_CASTLE));
              if ((pos.castling & 2) && !b[3] && !b[2] && !b[1] && b[0] === 4 && !attacked(pos, 4, them) && !attacked(pos, 3, them))
                out.push(encMove(4, 2, 6, 0, 0, F_CASTLE));
            } else {
              if ((pos.castling & 4) && !b[117] && !b[118] && b[119] === -4 && !attacked(pos, 116, them) && !attacked(pos, 117, them))
                out.push(encMove(116, 118, -6, 0, 0, F_CASTLE));
              if ((pos.castling & 8) && !b[115] && !b[114] && !b[113] && b[112] === -4 && !attacked(pos, 116, them) && !attacked(pos, 115, them))
                out.push(encMove(116, 114, -6, 0, 0, F_CASTLE));
            }
          }
        }
      } else {
        var dirs = at === 3 ? B_DIR : at === 4 ? R_DIR : K_OFF, n = dirs.length;
        for (var d = 0; d < n; d++) {
          var dd = dirs[d], tt = sq + dd;
          while (onBoard(tt)) {
            var c = b[tt];
            if (c) { if ((c > 0 ? WHITE : BLACK) === them) out.push(encMove(sq, tt, p, c, 0, 0)); break; }
            if (!capsOnly) out.push(encMove(sq, tt, p, 0, 0, 0));
            tt += dd;
          }
        }
      }
    }
    return out;
  }

  function doMove(pos, m) {
    var f = mf(m), t = mt(m), fl = mfl(m);
    var pc = pos.b[f], cap = pos.b[t];
    var promo = mpr(m);
    pos.stack.push({ m: m, cap: cap, castling: pos.castling, ep: pos.ep, half: pos.half, kw: pos.kw, kb: pos.kb, epcap: 0, h: pos.h });
    var us = pos.turn;
    var hh = pos.h ^ zPiece(pc, f);
    if (cap) hh ^= zPiece(cap, t);
    if (pos.ep >= 0) hh ^= ZEP[pos.ep & 7];
    pos.ep = -1;
    if (fl & F_EP) {
      var csq = t + (us === WHITE ? -16 : 16);
      pos.stack[pos.stack.length - 1].epcap = pos.b[csq];
      hh ^= zPiece(pos.b[csq], csq);
      pos.b[csq] = 0;
    }
    var placed = promo ? (us === WHITE ? promo : -promo) : pc;
    hh ^= zPiece(placed, t);
    pos.b[t] = placed;
    pos.b[f] = 0;
    if (fl & F_CASTLE) {
      var rf = t > f ? t + 1 : t - 2, rt = t > f ? t - 1 : t + 1;
      hh ^= zPiece(pos.b[rf], rf) ^ zPiece(pos.b[rf], rt);
      if (t > f) { pos.b[t - 1] = pos.b[t + 1]; pos.b[t + 1] = 0; }
      else { pos.b[t + 1] = pos.b[t - 2]; pos.b[t - 2] = 0; }
    }
    var apt = pc > 0 ? pc : -pc;
    if (apt === 6) { if (us === WHITE) pos.kw = t; else pos.kb = t; }
    var oldC = pos.castling;
    if (apt === 6) pos.castling &= us === WHITE ? ~3 : ~12;
    if (f === 0 || t === 0) pos.castling &= ~2;
    if (f === 7 || t === 7) pos.castling &= ~1;
    if (f === 112 || t === 112) pos.castling &= ~8;
    if (f === 119 || t === 119) pos.castling &= ~4;
    if (oldC !== pos.castling) hh ^= ZC[oldC] ^ ZC[pos.castling];
    if (fl & F_DBL) pos.ep = f + (us === WHITE ? 16 : -16);
    if (pos.ep >= 0) hh ^= ZEP[pos.ep & 7];
    hh ^= ZSIDE;
    pos.h = hh;
    pos.half = (apt === 1 || cap || pos.stack[pos.stack.length - 1].epcap) ? 0 : pos.half + 1;
    if (us === BLACK) pos.full++;
    pos.turn = -us;
  }

  function undoMove(pos) {
    var u = pos.stack.pop(), m = u.m;
    var f = mf(m), t = mt(m), fl = mfl(m);
    pos.turn = -pos.turn;
    if (pos.turn === BLACK) pos.full--;
    pos.b[f] = mp(m);
    pos.b[t] = 0;
    if (fl & F_EP) pos.b[t + (pos.turn === WHITE ? -16 : 16)] = u.epcap;
    else if (u.cap) pos.b[t] = u.cap;
    if (fl & F_CASTLE) {
      if (t > f) { pos.b[t + 1] = pos.b[t - 1]; pos.b[t - 1] = 0; }
      else { pos.b[t - 2] = pos.b[t + 1]; pos.b[t + 1] = 0; }
    }
    pos.castling = u.castling; pos.ep = u.ep; pos.half = u.half; pos.kw = u.kw; pos.kb = u.kb; pos.h = u.h;
  }

  function legalMoves(pos) {
    var out = [], ms = genMoves(pos, false), us = pos.turn;
    for (var i = 0; i < ms.length; i++) {
      doMove(pos, ms[i]);
      if (!inCheck(pos, us)) out.push(ms[i]);
      undoMove(pos);
    }
    return out;
  }

  // ---- fresh eval: Simplified-Evaluation-style PSTs, flat tunable vector ----
  // param layout: [0..4]=P,N,B,R,Q values, [5..68]=P pst64, [69..132]=N, [133..196]=B,
  // [197..260]=R, [261..324]=Q, [325..388]=Kmg, [389..452]=Keg, [453..]=scalars
  var N_SCALAR = 10;
  var N_PARAMS = 453 + N_SCALAR;
  // scalar order: bishopPair, doubled, isolated, passed, rookOpen, rookHalf, shield, tempo, mobility, kingOpen
  var SCALAR_DEF = [30, 12, 16, 26, 22, 11, 9, 10, 4, 14];

  var BASE_P = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  var BASE_N = [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50];
  var BASE_B = [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20];
  var BASE_R = [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0];
  var BASE_Q = [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20];
  var BASE_KMG = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
  var BASE_KEG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  function defaultTheta() {
    var th = new Float64Array(N_PARAMS);
    th[0] = 100; th[1] = 320; th[2] = 330; th[3] = 500; th[4] = 900;
    var tables = [BASE_P, BASE_N, BASE_B, BASE_R, BASE_Q, BASE_KMG, BASE_KEG];
    for (var t = 0; t < 7; t++)
      for (var i = 0; i < 64; i++) th[5 + t * 64 + i] = tables[t][i];
    for (var s = 0; s < N_SCALAR; s++) th[453 + s] = SCALAR_DEF[s];
    return th;
  }

  // white-relative index: rank1->rows 56..63? tables stored rank8-first like classic.
  // sq: file f, rank r (0=rank1). whiteIdx=(7-r)*8+f ; black mirrors: idx=r*8+f
  function pstIdx(sq, white) {
    var f = sq & 7, r = (sq >> 4) & 7;
    return white ? (7 - r) * 8 + f : r * 8 + f;
  }

  function evaluate(pos, th) {
    if (evalCacheOn) {
      var h = pos.h, hit = evalCache.get(h);
      if (hit !== undefined) return hit;
      var v = rawEvaluate(pos, th);
      if (evalCache.size > 400000) evalCache.clear();
      evalCache.set(h, v);
      return v;
    }
    return rawEvaluate(pos, th);
  }

  function rawEvaluate(pos, th) {
    var mg = 0, eg = 0, phase = 0;
    var b = pos.b;
    var wPawns = [0, 0, 0, 0, 0, 0, 0, 0], bPawns = [0, 0, 0, 0, 0, 0, 0, 0];
    var wBest = [-1, -1, -1, -1, -1, -1, -1, -1], bBest = [8, 8, 8, 8, 8, 8, 8, 8];
    var wB = 0, bB = 0, mob = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 136) { sq += 7; continue; }
      var p = b[sq];
      if (!p) continue;
      var w = p > 0, at = w ? p : -p;
      var idx = pstIdx(sq, w);
      if (at === 1) {
        var v = th[0] + th[5 + idx];
        if (w) { mg += v; eg += v; wPawns[sq & 7]++; var r = sq >> 4; if (r > wBest[sq & 7]) wBest[sq & 7] = r; }
        else { mg -= v; eg -= v; bPawns[sq & 7]++; var r2 = sq >> 4; if (r2 < bBest[sq & 7]) bBest[sq & 7] = r2; }
      } else if (at === 2) {
        var s2 = th[1] + th[69 + idx];
        if (w) { mg += s2; eg += s2; } else { mg -= s2; eg -= s2; }
        phase += 1; mob += w ? 1 : -1;
      } else if (at === 3) {
        var s3 = th[2] + th[133 + idx];
        if (w) { mg += s3; eg += s3; wB++; } else { mg -= s3; eg -= s3; bB++; }
        phase += 1;
      } else if (at === 4) {
        var s4 = th[3] + th[197 + idx];
        if (w) { mg += s4; eg += s4; } else { mg -= s4; eg -= s4; }
        phase += 2;
      } else if (at === 5) {
        var s5 = th[4] + th[261 + idx];
        if (w) { mg += s5; eg += s5; } else { mg -= s5; eg -= s5; }
        phase += 4;
      } else {
        var smg = th[325 + idx], seg = th[389 + idx];
        if (w) { mg += smg; eg += seg; } else { mg -= smg; eg -= seg; }
      }
    }
    var bp = th[453], dbl = th[454], iso = th[455], pass = th[456], rO = th[457], rH = th[458], sh = th[459], tempo = th[460], mobW = th[461];
    if (wB >= 2) { mg += bp; eg += bp; }
    if (bB >= 2) { mg -= bp; eg -= bp; }
    for (var f = 0; f < 8; f++) {
      if (wPawns[f] > 1) { mg -= dbl * (wPawns[f] - 1); eg -= dbl * (wPawns[f] - 1); }
      if (bPawns[f] > 1) { mg += dbl * (bPawns[f] - 1); eg += dbl * (bPawns[f] - 1); }
      var wl = f > 0 ? wPawns[f - 1] : 0, wr = f < 7 ? wPawns[f + 1] : 0;
      var bl = f > 0 ? bPawns[f - 1] : 0, br = f < 7 ? bPawns[f + 1] : 0;
      if (wPawns[f] && !wl && !wr) { mg -= iso * wPawns[f]; eg -= iso * wPawns[f]; }
      if (bPawns[f] && !bl && !br) { mg += iso * bPawns[f]; eg += iso * bPawns[f]; }
      if (wBest[f] >= 0 && bBest[f] > wBest[f] && (f === 0 || bBest[f - 1] > wBest[f]) && (f === 7 || bBest[f + 1] > wBest[f])) {
        var pb = pass * (0.25 + 0.22 * wBest[f]);
        mg += pb; eg += pb * 1.6;
      }
      if (bBest[f] <= 7 && wBest[f] < bBest[f] && (f === 0 || wBest[f - 1] < bBest[f]) && (f === 7 || wBest[f + 1] < bBest[f])) {
        var pb2 = pass * (0.25 + 0.22 * (7 - bBest[f]));
        mg -= pb2; eg -= pb2 * 1.6;
      }
    }
    // rook on open file + mobility + pawn shield
    var shieldW = 0, shieldB = 0;
    for (var sq2 = 0; sq2 < 128; sq2++) {
      if (sq2 & 136) { sq2 += 7; continue; }
      var p2 = b[sq2];
      if (!p2) continue;
      var a2 = p2 > 0 ? p2 : -p2;
      if (a2 === 4) {
        var fl2 = sq2 & 7;
        if ((p2 > 0 ? wPawns[fl2] : bPawns[fl2]) === 0) {
          var open = (p2 > 0 ? bPawns[fl2] : wPawns[fl2]) === 0 ? rO : rH;
          if (p2 > 0) { mg += open; eg += open; } else { mg -= open; eg -= open; }
        }
      }
    }
    var wk = pos.kw, bk = pos.kb;
    var wf = wk & 7, wr2 = wk >> 4, bf = bk & 7, br2 = bk >> 4;
    for (var df = -1; df <= 1; df++) {
      var nf = wf + df;
      if (nf >= 0 && nf < 8) { var s1 = ((wr2 + 1) << 4) | nf; if (!(s1 & 136) && b[s1] === 1) shieldW++; }
      var nf2 = bf + df;
      if (nf2 >= 0 && nf2 < 8) { var s2 = ((br2 - 1) << 4) | nf2; if (!(s2 & 136) && b[s2] === -1) shieldB++; }
    }
    mg += (shieldW - shieldB) * sh;
    mg += mob * mobW;
    if (phase > 24) phase = 24;
    var score = (mg * phase + eg * (24 - phase)) / 24 + tempo;
    return pos.turn === WHITE ? score : -score;
  }

  // ---- search ----
  var TT = new Map();
  var TT_GEN = 0;
  // eval cache: exact board-scan results keyed on incremental zobrist pos.h.
  // Scoped to a single think() (one theta); bypassed otherwise so supervised
  // tuning / adjudication with varying thetas never reads stale entries.
  var evalCache = new Map();
  var evalCacheOn = false;
  var killers = new Int32Array(256);
  var history = new Int32Array(16 * 128);
  var PIECE_W = [0, 100, 320, 330, 500, 900, 20000];

  function seeVal(p) { var a = p > 0 ? p : -p; return a <= 6 ? PIECE_W[a] : 0; }

  function orderMoves(ms, ttMove, ply) {
    var n = ms.length, scores = new Array(n);
    for (var i = 0; i < n; i++) {
      var m = ms[i];
      if (m === ttMove) { scores[i] = 3000000; continue; }
      var c = mc(m), pr = mpr(m);
      if (c || pr) scores[i] = 1000000 + (c ? seeVal(c) * 8 : 0) + pr * 400 - (seeVal(mp(m)) >> 4);
      else if (m === killers[ply * 2]) scores[i] = 900000;
      else if (m === killers[ply * 2 + 1]) scores[i] = 800000;
      else scores[i] = history[(mp(m) + 7) * 128 + (mt(m) & 127)] >> 2;
    }
    // insertion sort desc (fast, no alloc of objects)
    for (var a = 1; a < n; a++) {
      var mm = ms[a], ss = scores[a], j = a - 1;
      while (j >= 0 && scores[j] < ss) { ms[j + 1] = ms[j]; scores[j + 1] = scores[j]; j--; }
      ms[j + 1] = mm; scores[j + 1] = ss;
    }
    return ms;
  }

  function posHash(pos) { return pos.h; }

  function think(pos, th, opts) {
    opts = opts || {};
    var maxDepth = opts.depth || 3, timeMs = opts.timeMs || 0;
    var deadline = timeMs > 0 ? Date.now() + timeMs : Infinity;
    var nodes = 0, aborted = false;
    TT_GEN++;
    killers.fill(0);
    evalCache.clear();
    evalCacheOn = true;
    var root = legalMoves(pos);
    if (!root.length) { evalCacheOn = false; return null; }
    var best = root[0], bestScore = 0, done = 0;
    var t0 = Date.now();

    function qs(alpha, beta, ply) {
      nodes++;
      if ((nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return alpha; }
      var stand = evaluate(pos, th);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (ply > 24) return alpha;
      var caps = genMoves(pos, true);
      orderMoves(caps, 0, Math.min(ply, 120));
      for (var i = 0; i < caps.length; i++) {
        var m = caps[i];
        var c = mc(m), pr = mpr(m);
        if (!pr && c && stand + seeVal(c) + 180 < alpha) continue; // delta prune
        var us = pos.turn;
        doMove(pos, m);
        if (inCheck(pos, us)) { undoMove(pos); continue; }
        var v = -qs(-beta, -alpha, ply + 1);
        undoMove(pos);
        if (aborted) return alpha;
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
      return alpha;
    }

    function negamax(depth, alpha, beta, ply) {
      nodes++;
      if ((nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; return alpha; }
      if (pos.half >= 100) return 0;
      var us = pos.turn, chk = inCheck(pos, us);
      if (chk) depth++;
      if (depth <= 0) return qs(alpha, beta, ply);
      var h = posHash(pos), e = TT.get(h), ttM = 0;
      if (e && e.g === TT_GEN && e.d >= depth) {
        ttM = e.m;
        if (e.f === 1) return e.s;
        if (e.f === 2 && e.s >= beta) return e.s;
        if (e.f === 3 && e.s <= alpha) return e.s;
      }
      // reverse futility: static eval far above beta -> fail soft without searching
      var futile = false, standPrune = 0;
      if (!chk && beta < MATE - 1000) {
        if (depth === 2 || depth === 3) {
          var re = evaluate(pos, th);
          if (re - 135 * depth >= beta) return re;
        } else if (depth === 1) {
          standPrune = evaluate(pos, th);
          futile = standPrune + 175 <= alpha;
        }
      }
      // null move
      if (!chk && depth >= 3 && beta < MATE - 1000) {
        var hasMajor = false;
        var bb = pos.b;
        for (var s = 0; s < 128; s += 1) {
          if (s & 136) { s += 7; continue; }
          var pp = bb[s];
          if (pp && (pp > 0 ? WHITE : BLACK) === us) { var aa = pp > 0 ? pp : -pp; if (aa !== 1 && aa !== 6) { hasMajor = true; break; } }
        }
        if (hasMajor) {
          var sv = pos.ep;
          pos.stack.push({ m: 0, cap: 0, castling: pos.castling, ep: pos.ep, half: pos.half, kw: pos.kw, kb: pos.kb, epcap: 0, h: pos.h, null: true });
          if (sv >= 0) pos.h ^= ZEP[sv & 7];
          pos.h ^= ZSIDE;
          pos.ep = -1; pos.turn = -us;
          var R = depth > 6 ? 3 : 2;
          var v = -negamax(depth - 1 - R, -beta, -beta + 1, ply + 1);
          var uu = pos.stack.pop();
          pos.ep = uu.ep; pos.turn = us; pos.h = uu.h;
          if (aborted) return alpha;
          if (v >= beta) return v;
        }
      }
      var ms = genMoves(pos, false);
      orderMoves(ms, ttM, Math.min(ply, 120));
      var legal = 0, bestV = -INF, bestM = 0, origA = alpha;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        var isTact = mc(m) !== 0 || mpr(m) !== 0 || (mfl(m) & F_EP) !== 0;
        // futility: skip quiet moves once at least one legal move was searched
        // (legal>0 guard preserves mate/stalemate detection)
        if (futile && legal > 0 && !isTact && m !== ttM) continue;
        doMove(pos, m);
        if (inCheck(pos, us)) { undoMove(pos); continue; }
        legal++;
        var v2;
        if (i === 0 || depth < 3) v2 = -negamax(depth - 1, -beta, -alpha, ply + 1);
        else {
          var red = (!isTact && !chk && i >= 4) ? (i >= 9 && depth >= 4 ? 2 : 1) : 0;
          v2 = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1);
          if (red && v2 > alpha) v2 = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
          if (v2 > alpha && v2 < beta) v2 = -negamax(depth - 1, -beta, -alpha, ply + 1);
        }
        undoMove(pos);
        if (aborted) return bestV === -INF ? alpha : bestV;
        if (v2 > bestV) { bestV = v2; bestM = m; }
        if (v2 > alpha) {
          alpha = v2;
          if (v2 >= beta) {
            if (!isTact) {
              var kp = Math.min(ply, 120) * 2;
              if (killers[kp] !== m) { killers[kp + 1] = killers[kp]; killers[kp] = m; }
              history[(mp(m) + 7) * 128 + (mt(m) & 127)] += depth * depth;
            }
            break;
          }
        }
      }
      if (!legal) return chk ? -(MATE - ply) : 0;
      var fl = bestV <= origA ? 3 : bestV >= beta ? 2 : 1;
      if (TT.size > 400000) TT.clear();
      TT.set(h, { s: bestV, d: depth, f: fl, m: bestM, g: TT_GEN });
      return bestV;
    }

    // iterative deepening with aspiration
    var prev = root.map(function (m) { return { m: m, s: 0 }; });
    for (var d = 1; d <= maxDepth; d++) {
      prev.sort(function (a, b) { return b.s - a.s; });
      var scored = [], alpha = -INF, lb = null, lv = -INF;
      var window = d >= 4 ? 28 : INF;
      for (var ri = 0; ri < prev.length; ri++) {
        var rm = prev[ri].m;
        doMove(pos, rm);
        var us2 = -pos.turn;
        // mate/stalemate guard: if illegal, skip
        var illegal = inCheck(pos, us2);
        var val;
        if (illegal) { undoMove(pos); scored.push({ m: rm, s: -INF }); continue; }
        if (ri === 0) val = -negamax(d - 1, -INF, INF, 1);
        else {
          var guess = prev[ri].s; // this move's root score from the previous depth
          val = -negamax(d - 1, -guess - window, -guess + window, 1);
          if (val <= guess - window || val >= guess + window)
            val = -negamax(d - 1, -INF, INF, 1);
        }
        undoMove(pos);
        if (aborted) break;
        scored.push({ m: rm, s: val });
        if (val > lv) { lv = val; lb = rm; }
        if (val > alpha) alpha = val;
      }
      if (aborted) break;
      if (lb !== null) { best = lb; bestScore = lv; done = d; prev = scored; }
      if (Math.abs(bestScore) > MATE - 200) break;
      if (Date.now() > deadline) break;
    }
    evalCacheOn = false;
    return { move: best, score: bestScore, depth: done, nodes: nodes, ms: Date.now() - t0 };
  }

  function moveToString(pos, m) {
    if (!m) return "null";
    var s = sqName(mf(m)) + sqName(mt(m));
    if (mpr(m)) s += "PNBRQK"[mpr(m) - 1].toLowerCase();
    return s;
  }

  function perft(pos, depth) {
    if (depth === 0) return 1;
    var ms = legalMoves(pos);
    if (depth === 1) return ms.length;
    var n = 0;
    for (var i = 0; i < ms.length; i++) { doMove(pos, ms[i]); n += perft(pos, depth - 1); undoMove(pos); }
    return n;
  }

  return {
    WHITE: WHITE, BLACK: BLACK, PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    MATE: MATE, INF: INF, N_PARAMS: N_PARAMS, N_SCALAR: N_SCALAR,
    newPos: newPos, startPos: startPos, setFen: setFen, getFen: getFen,
    sqName: sqName, parseSq: parseSq, mf: mf, mt: mt, mp: mp, mc: mc, mpr: mpr, mfl: mfl,
    attacked: attacked, inCheck: inCheck, genMoves: genMoves, legalMoves: legalMoves,
    doMove: doMove, undoMove: undoMove, evaluate: evaluate, think: think,
    defaultTheta: defaultTheta, moveToString: moveToString, perft: perft
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { makeEngine: makeEngine };
if (typeof globalThis !== "undefined") globalThis.FreshEngine = { makeEngine: makeEngine };
