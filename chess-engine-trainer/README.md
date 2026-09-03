# Chess Engine Trainer (v2 — fresh, standalone)

Brand-new Stockfish-style trainer. Zero imports from `chess-trainer/`. Zero deps. Bun or Node.

- **Engine** (`src/engine.js`): 0x88 board, signed pieces, tapered eval (material + 7×64 PSTs + 10 scalars = 463 flat params), alpha-beta + quiescence (delta prune) + TT + null-move + LMR + killers/history, aspiration windows, iterative deepening.
- **Trainer** (`src/trainer.js`): SPSA self-play tuning (Stockfish-style `a_k / c_k` schedule), Texel-style warmup, SPRT helper, Elo calc, JSON brains.
- **CLI**: `train.js` (SPSA loop), `bench.js` (nps + mate + games/min), `test.js` (perft + search + trainer).

## Quick start

```powershell
cd chess-engine-trainer
bun test.js        # 19/19 should pass
bun bench.js       # ~600k+ nps, ~500+ games/min single-thread depth 1
bun train.js --minutes 5 --depth 2 --games 16
bun train.js --minutes 10 --depth 2 --games 32 --texel 200 --out brains/brain-v2.json
```

Brains save to `brains/brain-v2.json` (`gen`, `games`, `theta[463]`). Ctrl+C stops early — every iteration is saved.

## Why this is stronger/faster than hill-climbing

- SPSA tunes all 463 params at once from win/loss gradient instead of random Gaussian blobs.
- Single mirrored PST set (white-relative) halves params and generalizes better.
- Aspiration + delta-pruned quiescence + insertion-sort ordering = higher nps.
- Short bullet games (depth 1–2, 6 random opening plies, adjudication) = hundreds of games/min per core.
