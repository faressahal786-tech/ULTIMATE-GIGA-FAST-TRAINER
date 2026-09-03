"use strict";
// Minimal worker-thread pool for parallel self-play. Zero deps (worker_threads
// + path + os only), standalone (never imports from chess-trainer/).
// Returns null when threads are unavailable or n <= 1 so single-threaded
// behavior stays byte-for-byte identical to the old sequential loop.
var path = require("path");
var WT = null;
try { WT = require("worker_threads"); } catch (e) { WT = null; }

function cpuCount() {
  try {
    var cpus = require("os").cpus();
    return (cpus && cpus.length) || 4;
  } catch (e) { return 4; }
}

function makePool(nThreads) {
  var n = nThreads == null ? cpuCount() : parseInt(nThreads, 10);
  if (!(n > 1) || !WT || typeof WT.Worker !== "function") return null;
  if (n > 64) n = 64;
  var workerPath = path.join(__dirname, "play-worker.js");
  var workers = [];
  for (var i = 0; i < n; i++) {
    (function () {
      var w = new WT.Worker(workerPath);
      w._seq = 0;
      w._pending = new Map();
      w.on("message", function (msg) {
        if (!msg) return;
        var p = w._pending.get(msg.id);
        if (p) { w._pending.delete(msg.id); p.resolve(msg.results); }
      });
      w.on("error", function (err) {
        w._pending.forEach(function (p) { p.reject(err); });
        w._pending.clear();
      });
      w.on("exit", function (code) {
        if (code !== 0 && w._pending.size) {
          var err = new Error("self-play worker exited with code " + code);
          w._pending.forEach(function (p) { p.reject(err); });
          w._pending.clear();
        }
      });
      workers.push(w);
    })();
  }

  // Self-scheduling dispatch: one job in flight per worker, each worker pulls
  // the next job as it finishes. Game lengths vary wildly (quick mate vs full
  // 120-ply adjudication), so static shards stall on stragglers. Results are
  // reassembled in input order.
  function runGames(jobs) {
    jobs = jobs || [];
    return new Promise(function (resolve, reject) {
      var results = new Array(jobs.length);
      var next = 0, done = 0, failed = false;
      if (!jobs.length) { resolve(results); return; }
      function dispatch(w) {
        if (failed || next >= jobs.length) return;
        var idx = next++;
        var id = (w._seq = (w._seq + 1) | 0);
        w._pending.set(id, {
          resolve: function (res) {
            results[idx] = res[0];
            if (++done === jobs.length) resolve(results);
            else dispatch(w);
          },
          reject: function (err) {
            if (!failed) { failed = true; reject(err); }
          }
        });
        w.postMessage({ id: id, jobs: [jobs[idx]] });
      }
      workers.forEach(dispatch);
    });
  }

  function close() {
    return Promise.all(workers.map(function (w) { return w.terminate(); })).then(function () {});
  }

  return { size: workers.length, parallel: true, runGames: runGames, close: close };
}

if (typeof module !== "undefined" && module.exports) module.exports = { makePool: makePool, cpuCount: cpuCount };
