import { isRecord } from "./guards.js";

/**
 * Extract searchable text lines from a transcript line's `message.content`.
 *
 * `content` is either a plain string or an array of content blocks. Blocks come
 * in several shapes (text / thinking / tool_use / tool_result / image); each is
 * flattened to zero or more text lines. Anything unrecognised is skipped rather
 * than throwing — the schema is undocumented and drifts, so extraction degrades
 * gracefully. A block's own text may contain newlines; those are split so that
 * matching and `-C N` context operate per visual line.
 */
export function extractTextLines(content: unknown): string[] {
  const out: string[] = [];
  collect(content, out, 0);
  return out.flatMap((s) => s.split("\n"));
}

// Bound recursion so a pathological nested structure can't blow the stack.
const MAX_DEPTH = 8;

function collect(node: unknown, out: string[], depth: number): void {
  if (node == null || depth > MAX_DEPTH) return;

  if (typeof node === "string") {
    if (node.length > 0) out.push(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, depth + 1);
    return;
  }

  if (!isRecord(node)) return;
  const block = node;

  switch (block["type"]) {
    case "text":
      collect(block["text"], out, depth + 1);
      return;
    case "thinking":
      collect(block["thinking"], out, depth + 1);
      return;
    case "tool_result":
      // `content` is a string or an array of `{type:"text", text}` blocks.
      collect(block["content"], out, depth + 1);
      return;
    case "tool_use":
      // Serialize the tool input so `cc-grep` matches on e.g. Bash commands or
      // file paths the assistant acted on.
      if (block["input"] != null) out.push(safeStringify(block["input"]));
      return;
    case "image":
      return; // no text to search
    default:
      // Unknown block shape: opportunistically pull common text-bearing fields.
      if (typeof block["text"] === "string") out.push(block["text"]);
      return;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
