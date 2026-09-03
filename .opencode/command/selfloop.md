---
description: Run one self-improvement cycle on chess-engine-trainer — pick backlog item, implement, test, bench, commit.
---

# Self-loop (one cycle) — chess-engine-trainer

You are in a self-prompting improvement loop. Run exactly ONE cycle, then stop and re-prompt:

1. Read `chess-engine-trainer/.selfloop.md` (backlog, run log, baselines).
2. Take the top backlog item. If the backlog is empty, audit `src/engine.js` + `src/trainer.js` for the highest-value bug or speedup and add it first.
3. Implement it as a minimal diff. Constraints: JS only, zero deps, standalone (never import from `chess-trainer/`), no behavior change except the item's goal.
4. Verify: `bun test.js` inside `chess-engine-trainer/` must print `19 passed, 0 failed`. If red, fix or fully revert — never commit red.
5. Bench: `bun bench.js` plus the depth-6 probe from the state file. Record nodes / nps / games-min vs baseline.
6. Commit THAT change alone (stage only its files, never push):
   `git -c user.name="chess-trainer" -c user.email="chess-trainer@local" commit -m "<type>: <what> (<numbers>)"`
   Types: `fix`, `perf`, `feat`, `chore`.
7. Update `chess-engine-trainer/.selfloop.md`: move the item to the run log with result numbers, refresh baselines, append any new ideas to the backlog. Commit the state file in the same commit.
8. Reply with: change, test result, bench delta, commit hash — ending with exactly:
   `Loop waiting — send /selfloop (or "loop N") for the next cycle.`
