"use strict";
// Worker entry for parallel self-play. One instance runs per pool thread; the
// engine + trainer are created once and reused sequentially across jobs.
// Main-thread require() is a no-op (guarded by isMainThread).
var path = require("path");
var WT = null;
try { WT = require("worker_threads"); } catch (e) { WT = null; }

if (WT && !WT.isMainThread && WT.parentPort) {
  var makeEngine = require(path.join(__dirname, "engine.js")).makeEngine;
  var makeTrainer = require(path.join(__dirname, "trainer.js")).makeTrainer;
  var engine = makeEngine();
  var trainer = makeTrainer(engine);

  WT.parentPort.on("message", function (msg) {
    if (!msg || msg.cmd === "close") return;
    var jobs = msg.jobs || [];
    var out = new Array(jobs.length);
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var rng = trainer.mulberry32(job.seed >>> 0);
      var r = trainer.playGame(job.thPlus, job.thMinus, {
        depth: job.depth, maxPlies: job.maxPlies, openPlies: job.openPlies, rng: rng
      });
      out[i] = {
        plusScore: r.result === "d" ? 0.5 : ((r.result === "w") === job.plusWhite ? 1 : 0),
        plies: r.plies, result: r.result, reason: r.reason
      };
    }
    WT.parentPort.postMessage({ id: msg.id, results: out });
  });
}
