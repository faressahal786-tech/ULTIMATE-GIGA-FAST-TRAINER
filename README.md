# ULTIMATE GIGA FAST TRAINER

Fast Stockfish-style chess engine trainer: SPSA + Texel tuning, stronger search, parallel self-play. Zero deps. Bun or Node.

## Quick start

```powershell
cd chess-engine-trainer
bun test.js        # perft + search + trainer checks
bun bench.js       # nps + mate tests + games/min probe
bun train.js --minutes 5 --depth 2 --games 16 --threads 0   # 0 = all cores
```

Brains save to `chess-engine-trainer/brains/brain-v2.json`. Ctrl+C stops early — every iteration is saved.

## How it works

1. **Engine** (`src/engine.js`) — 0x88 board, alpha-beta + quiescence + transposition table + null-move + LMR + futility + root PVS, tapered eval (material + PSTs + mobility + king safety). All 463 eval numbers are learnable.
2. **Trainer** (`src/trainer.js`) — SPSA self-play tuning (Stockfish-style schedule), Texel-style warmup, SPRT/Elo helpers, worker-thread pool.
3. **Looper** (lives outside the repo) — `selfloop.py` prints the next improvement prompt, `autoloop.ps1` feeds prompts to the agent round after round, one commit per change.
