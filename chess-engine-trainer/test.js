"use strict";
const path = require("path");
const { makeEngine } = require(path.join(__dirname, "src", "engine.js"));
const { makeTrainer } = require(path.join(__dirname, "src", "trainer.js"));
const engine = makeEngine();
const trainer = makeTrainer(engine);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("FAIL  " + name + (extra !== undefined ? " -> " + extra : "")); }
}

console.log("[perft]");
const suite = [
  { name: "startpos", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", counts: [20, 400, 8902] },
  { name: "kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", counts: [48, 2039] },
  { name: "pos3", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", counts: [14, 191, 2812] }
];
for (const t of suite) {
  const pos = engine.setFen(engine.newPos(), t.fen);
  for (let d = 0; d < t.counts.length; d++) {
    const n = engine.perft(engine.setFen(engine.newPos(), t.fen), d + 1);
    check(`${t.name} d${d + 1}`, n === t.counts[d], `expected ${t.counts[d]} got ${n}`);
  }
}

console.log("[fen]");
{
  const pos = engine.startPos();
  const fen = engine.getFen(pos);
  check("start fen", fen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", fen);
  const m = engine.legalMoves(pos)[0];
  engine.doMove(pos, m);
  engine.undoMove(pos);
  check("unmake restores", engine.getFen(pos) === fen);
}

console.log("[search]");
{
  const th = engine.defaultTheta();
  const mate = engine.setFen(engine.newPos(), "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
  const r = engine.think(mate, th, { depth: 2 });
  const ok = r && engine.sqName(engine.mf(r.move)) === "h5" && engine.sqName(engine.mt(r.move)) === "f7";
  check("finds Qxf7", ok, r ? engine.moveToString(mate, r.move) + " s=" + Math.round(r.score) : "null");
  check("mate score big", r && Math.abs(r.score) > engine.MATE - 1000, String(r && r.score));
  const start = engine.startPos();
  const rs = engine.think(start, th, { depth: 2 });
  check("start move legal", rs && engine.legalMoves(start).indexOf(rs.move) >= 0);
  check("nodes>0", rs && rs.nodes > 0, String(rs && rs.nodes));
}

console.log("[trainer]");
{
  const rng = trainer.mulberry32(42);
  const brain = trainer.newBrain();
  check("theta size", brain.theta.length === engine.N_PARAMS, String(brain.theta.length));
  const res = trainer.spsaIter(brain, { rng, k: 1, gamesPerIter: 4, depth: 1 });
  check("spsa iter runs", !!res && brain.games === 4, JSON.stringify({ g: brain.games }));
  const json = trainer.saveBrain(brain);
  const back = trainer.loadBrain(json);
  check("brain roundtrip", JSON.stringify(back.theta) === JSON.stringify(brain.theta));
  const g = trainer.playGame(brain.theta, brain.theta, { depth: 1, maxPlies: 40, openPlies: 2, rng });
  check("self-play ends", ["w", "b", "d"].indexOf(g.result) >= 0, JSON.stringify(g));
  check("elo fn", Math.abs(trainer.eloDiff(0.75) - 191) < 5, String(trainer.eloDiff(0.75)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
