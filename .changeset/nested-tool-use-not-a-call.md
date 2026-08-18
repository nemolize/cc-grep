---
"@nemolize/cc-grep": patch
---

Stop counting a `tool_use` block nested inside a `tool_result` as a call the
session made.

A tool's output is data, not a record of what the session did, so anything that
echoes transcript-shaped JSON back — a log dump, a pasted API response, this
tool's own `--json` output — could put a `tool_use` block there and have the
session read as having called it. `--tool` and `--file` now filter on the
assistant's own calls only. Text inside a `tool_result` is still extracted and
searchable, unchanged.
