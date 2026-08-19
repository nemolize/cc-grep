---
"@nemolize/cc-grep": minor
---

Render tool calls for a reader rather than as raw arguments. The tool's name now
tags the hit header instead of taking a body line, an `Edit` shows its two sides
as a diff, and an argument that carries no meaning (`replace_all`) is left out
when it leads the call and is not itself what matched. Matching and `--json` are
unchanged: the shaping is display-only, so `old_string:` still finds an edit.

Telling an argument from a line of file content that looks like one is a
heuristic, since extraction keeps a value's newlines but not the record of where
they were. It is deliberately conservative: a wrong guess never hides a line, and
a line that matched always prints — it can only carry a `-`/`+` marker onto lines
that are not part of that value.
