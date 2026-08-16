---
"@nemolize/cc-grep": minor
---

pr: #42

Add `--session` to dump one session as a conversation. Search narrows to a
session id, but reading that session back had no route through the tool;
`--session` prints it whole instead of searching across all sessions. The id
resolves by prefix, so the 8-char form search prints is enough, and the pattern
becomes optional — passing one alongside `--session` keeps search semantics and
highlights within the turns it selects. Filters compose unchanged and `--json`
emits the same per-hit objects, so a dump pipes to `jq` like a search.
