---
"@nemolize/cc-grep": minor
---

Add survey flags so a broad pattern can be narrowed before printing it: `-c/--count` reports the hit total, `-l/--list-sessions` reports one line per matching session ordered most hits first, and `-m/--max-count <N>` stops the scan after N hits and notes on stderr that it capped. Both summaries pair with `--json`, and neither combines with `--resume`/`--print-resume` (a summary prints no hit to resume, so the combination is a usage error). `--help` now carries an Examples section and a note that a broad pattern can print megabytes.
