"use strict";
const path = require("path");
const { makeEngine } = require(path.join(__dirname, "src", "engine.js"));
const engine = makeEngine();
const th = engine.defaultTheta();

let t0 = Date.now();
const r = engine.think(engine.startPos(), th, { depth: 4 });
const dt = (Date.now() - t0) / 1000;
console.log(`depth ${r.depth} - ${r.nodes} nodes - ${(r.nodes / Math.max(0.01, dt) / 1000).toFixed(1)}k nps - best ${engine.moveToString(engine.startPos(), r.move)} score ${Math.round(r.score)}`);

const mate = engine.setFen(engine.newPos(), "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
const m = engine.think(mate, th, { depth: 3 });
console.log(`mate test: ${engine.moveToString(mate, m.move)} score ${Math.round(m.score)} nodes ${m.nodes}`);

// games/min probe: 10 bullet games depth 1
const { makeTrainer } = require(path.join(__dirname, "src", "trainer.js"));
const trainer = makeTrainer(engine);
const g0 = Date.now();
for (let i = 0; i < 10; i++) trainer.playGame(Array.from(th), Array.from(th), { depth: 1, maxPlies: 100, openPlies: 6, rng: trainer.mulberry32(i + 1) });
const gdt = (Date.now() - g0) / 60000;
console.log(`self-play probe: ${(10 / Math.max(0.001, gdt)).toFixed(1)} games/min single-thread (depth 1)`);
