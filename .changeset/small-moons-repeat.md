---
"@nemolize/cc-grep": minor
---

Render tool calls for a reader rather than as raw arguments. The tool's name now
tags the hit header instead of taking a body line, an `Edit` shows its two sides
as a diff, and arguments that carry no meaning (`replace_all`) are left out
unless they are what matched. Matching and `--json` are unchanged: the shaping is
display-only, so `old_string:` still finds an edit.

Telling an argument from a line of file content that looks like one is a
heuristic, since extraction keeps a value's newlines but not the record of where
they were. It is deliberately conservative — content is never hidden by a wrong
guess, only a diff marker can extend one line too far.
