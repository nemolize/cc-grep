---
"@nemolize/cg": minor
---

`--json` now carries each tool call's input as `toolCalls[].input`, as each agent recorded it (Codex `function_call` arguments parsed from JSON), in full.
