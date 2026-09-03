#!/usr/bin/env python3
"""Self-loop prompter for chess-engine-trainer.

The loop memory is `.selfloop.md` (backlog + run log + baselines).
Each run prints the next prompt; the agent works it, commits, then runs again.

Usage (from chess-engine-trainer/):
    python selfloop.py next              # print the next self-prompt (default)
    python selfloop.py list              # show backlog + recent runs
    python selfloop.py add "<item>"      # append a backlog item
    python selfloop.py done "<log entry>"# move top item to run log with this entry
"""
import re
import sys
from pathlib import Path

try:
    # Windows consoles default to cp1252, which chokes on arrows etc. in state text.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

STATE = Path(__file__).with_name(".selfloop.md")
BACKLOG_H = "## Backlog"
RUNLOG_H = "## Run log"
ITEM_RE = re.compile(r"^(\d+)\.\s+(.*\S)\s*$")


def read_state():
    return STATE.read_text(encoding="utf-8").splitlines()


def split_sections(lines):
    """Return (pre_backlog, backlog_lines, mid, runlog_lines, post)."""
    try:
        bi = next(i for i, l in enumerate(lines) if l.strip() == BACKLOG_H or l.strip().startswith(BACKLOG_H + " "))
    except StopIteration:
        sys.exit("state file missing '%s' section" % BACKLOG_H)
    try:
        ri = next(i for i, l in enumerate(lines) if l.strip() == RUNLOG_H)
    except StopIteration:
        sys.exit("state file missing '%s' section" % RUNLOG_H)
    if ri < bi:
        sys.exit("malformed state file: run log sits above backlog")
    return lines[: bi + 1], lines[bi + 1 : ri], [lines[ri]], lines[ri + 1 :], []


def get_items(backlog_lines):
    return [(m.group(1), m.group(2)) for l in backlog_lines for m in [ITEM_RE.match(l)] if m]


def cmd_next():
    lines = read_state()
    pre, blog, _, _, _ = split_sections(lines)
    del pre
    items = get_items(blog)
    if not items:
        print("LOOP COMPLETE — backlog is empty. Add more with: python selfloop.py add \"<item>\"")
        return
    n = len(items)
    print("=== SELF-LOOP PROMPT (item 1 of %d) ===" % n)
    print("Task: %s" % items[0][1])
    print("Project: chess-engine-trainer/ (JS, zero deps, standalone - never import from chess-trainer/)")
    print("Do:")
    print("  1. Implement the task as a minimal diff.")
    print("  2. Verify: `bun test.js` must print `19 passed, 0 failed`. If red, fix or fully revert.")
    print("  3. Bench: `bun bench.js` + the depth-6 probe in .selfloop.md; compare vs baselines.")
    print("  4. Commit THAT change alone (stage only its files, never push):")
    print('     git -c user.name="chess-trainer" -c user.email="chess-trainer@local" commit -m "<type>: <what> (<numbers>)"')
    print("  5. Record it: python selfloop.py done \"<run-log entry with numbers>\"")
    print("     (refresh baselines in .selfloop.md first if they changed; amend into the same commit)")
    print("Then run: python selfloop.py next")
    print("=== END PROMPT ===")


def cmd_list():
    lines = read_state()
    _, blog, _, runlog, _ = split_sections(lines)
    items = get_items(blog)
    print("Backlog (%d):" % len(items))
    for num, text in items:
        print("  %s. %s" % (num, text))
    print("Recent runs:")
    for l in [l for l in runlog if l.startswith("- ")][-5:]:
        print("  %s" % l)


def write_state(pre, blog, mid, runlog):
    STATE.write_text("\n".join(pre + blog + mid + runlog) + "\n", encoding="utf-8")


def cmd_add(text):
    lines = read_state()
    pre, blog, mid, runlog, _ = split_sections(lines)
    items = get_items(blog)
    blog = [l for l in blog if not ITEM_RE.match(l)]
    items.append((str(len(items) + 1), text))
    numbered = ["%d. %s" % (i + 1, t) for i, (_, t) in enumerate(items)]
    # keep any trailing blank/comment lines that were after the items
    write_state(pre, numbered + [""], mid, runlog)
    print("added backlog item %d." % len(items))


def cmd_done(entry):
    lines = read_state()
    pre, blog, mid, runlog, _ = split_sections(lines)
    items = get_items(blog)
    if not items:
        sys.exit("nothing to mark done - backlog is empty")
    finished = items.pop(0)
    numbered = ["%d. %s" % (i + 1, t) for i, (_, t) in enumerate(items)]
    rest = [l for l in blog if not ITEM_RE.match(l)]
    runlog = runlog + ["- %s" % entry]
    write_state(pre, numbered + rest, mid, runlog)
    print("closed: %s" % finished[1])


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "next"
    if cmd == "next":
        cmd_next()
    elif cmd == "list":
        cmd_list()
    elif cmd == "add":
        if len(argv) < 3:
            sys.exit('usage: python selfloop.py add "<item>"')
        cmd_add(argv[2])
    elif cmd == "done":
        if len(argv) < 3:
            sys.exit('usage: python selfloop.py done "<log entry>"')
        cmd_done(argv[2])
    else:
        sys.exit("unknown command %r (next|list|add|done)" % cmd)


if __name__ == "__main__":
    main(sys.argv)
