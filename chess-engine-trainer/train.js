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
const threads = parseInt(arg("threads", "1"), 10);

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
console.log(`fresh SPSA training: ${minutes} min - depth ${depth} - ${gamesPerIter} games/iter - seed ${seed} - threads ${threads}`);
console.log("Ctrl+C stops early (brain saved every iteration)");

let stop = false;
process.on("SIGINT", () => { console.log("\nstopping..."); stop = true; });

async function main() {
  let pool = null;
  if (threads === 0 || threads > 1) {
    const { makePool } = require(path.join(__dirname, "src", "pool.js"));
    pool = makePool(threads);
    if (!pool) console.log("worker_threads unavailable - falling back to single thread");
    else console.log(`worker pool: ${pool.size} threads`);
  }
  const t0 = Date.now();
  let iter = 0;
  while (!stop && Date.now() < deadline) {
    iter++;
    const sopts = { rng, k: brain.gen + 1, gamesPerIter, depth, maxPlies: 120, openPlies: 6 };
    const r = pool ? await trainer.spsaIterParallel(brain, sopts, pool) : trainer.spsaIter(brain, sopts);
    save();
    const el = Date.now() - t0;
    const rate = (brain.games / Math.max(0.01, el / 60000)).toFixed(1);
    console.log(`iter ${iter} (k=${r.k}) score ${r.score}/${r.games} W${r.w} L${r.l} D${r.d} eloPlus ${r.eloPlus.toFixed(1)} avgPlies ${r.avgPlies} - total ${brain.games} games ${rate}/min`);
  }
  if (pool) await pool.close();
  save();
  console.log(`done: gen ${brain.gen} - ${brain.games} games - saved to ${outPath}`);
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
