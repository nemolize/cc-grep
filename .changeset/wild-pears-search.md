---
"@nemolize/cc-grep": minor
---

Add survey flags so a broad pattern can be narrowed before printing it: `-c/--count` reports the hit total, `-l/--list-sessions` reports one line per matching session, and `-m/--max-count <N>` stops the scan after N hits. Both summaries pair with `--json`. `--help` now carries an Examples section and a note that a broad pattern can print megabytes.
