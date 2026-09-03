"use strict";
const path = require("path");
const fs = require("fs");
const { makeEngine } = require(path.join(__dirname, "src", "engine.js"));
const { makeTrainer } = require(path.join(__dirname, "src", "trainer.js"));

const engine = makeEngine();
const trainer = makeTrainer(engine);

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1 || i + 1 >= process.argv.length) return def;
  return process.argv[i + 1];
}

const minutes = parseFloat(arg("minutes", "5"));
const depth = parseInt(arg("depth", "2"), 10);
const gamesPerIter = parseInt(arg("games", "16"), 10);
const outPath = path.resolve(__dirname, arg("out", "brains/brain-v2.json"));
const seed = parseInt(arg("seed", String((Math.random() * 0xffffffff) >>> 0)), 10);
const texelGames = parseInt(arg("texel", "0"), 10);

if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });

let brain;
if (fs.existsSync(outPath)) {
  brain = trainer.loadBrain(fs.readFileSync(outPath, "utf8"));
  console.log(`resuming brain-v2 gen ${brain.gen} games ${brain.games}`);
} else {
  brain = trainer.newBrain();
}

const rng = trainer.mulberry32(seed);
if (texelGames > 0) {
  console.log(`texel warmup: ${texelGames} sample positions...`);
  const ds = trainer.buildDataset(texelGames, 1, seed);
  brain.theta = trainer.texelTune(brain.theta, ds, { epochs: 3, rng });
  console.log(`texel warmup done (${ds.length} positions)`);
}

function save() {
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, trainer.saveBrain(brain));
  fs.renameSync(tmp, outPath);
}

const deadline = Date.now() + minutes * 60000;
console.log(`fresh SPSA training: ${minutes} min - depth ${depth} - ${gamesPerIter} games/iter - seed ${seed}`);
console.log("Ctrl+C stops early (brain saved every iteration)");

let stop = false;
process.on("SIGINT", () => { console.log("\nstopping..."); stop = true; });

const t0 = Date.now();
let iter = 0;
while (!stop && Date.now() < deadline) {
  iter++;
  const r = trainer.spsaIter(brain, { rng, k: brain.gen + 1, gamesPerIter, depth, maxPlies: 120, openPlies: 6 });
  save();
  const el = Date.now() - t0;
  const rate = (brain.games / Math.max(0.01, el / 60000)).toFixed(1);
  console.log(`iter ${iter} (k=${r.k}) score ${r.score}/${r.games} W${r.w} L${r.l} D${r.d} eloPlus ${r.eloPlus.toFixed(1)} avgPlies ${r.avgPlies} - total ${brain.games} games ${rate}/min`);
}
save();
console.log(`done: gen ${brain.gen} - ${brain.games} games - saved to ${outPath}`);
process.exit(0);
