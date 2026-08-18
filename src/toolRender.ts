import { TOOL_MARK } from "./textExtract.js";

/**
 * Extraction stays verbatim so a search still reaches every field; this layer
 * only decides how those same lines are shown.
 */
export interface LineDecoration {
  /** Replaces the line's text. Undefined leaves it as extracted. */
  text?: string | undefined;
  /** Hidden from the rendered body unless the line itself matched. */
  suppressed?: boolean | undefined;
  /** Set on the `⚙ <name>` header only, so a caller can lift the name away. */
  toolName?: string | undefined;
}

/**
 * Keyed by tool name, which is arbitrary transcript data — `Map` rather than an
 * object literal so a name like `constructor` cannot reach a prototype member.
 */
interface ToolProfile {
  /** Fields whose value is noise to a reader of this tool's call. */
  suppressed: ReadonlySet<string>;
  /** Fields shown as a diff side rather than a `key: value` pair. */
  diffMarkers: ReadonlyMap<string, string>;
  /**
   * A key outside this set continues the previous value instead of starting a
   * field — edited file content routinely holds `key: value` lines of its own.
   */
  fields: ReadonlySet<string>;
}

function editProfile(): ToolProfile {
  return {
    suppressed: new Set(["replace_all"]),
    diffMarkers: new Map([
      ["old_string", "-"],
      ["new_string", "+"],
    ]),
    fields: new Set(["file_path", "old_string", "new_string", "replace_all"]),
  };
}

const TOOL_PROFILES: ReadonlyMap<string, ToolProfile> = new Map([
  ["Edit", editProfile()],
  ["MultiEdit", editProfile()],
]);

/** `key: rest` split on the first colon-space, or undefined for a body line. */
function splitField(line: string): { key: string; rest: string } | undefined {
  const at = line.indexOf(": ");
  if (at <= 0) {
    if (line.endsWith(":") && line.length > 1 && !line.includes(" ")) {
      return { key: line.slice(0, -1), rest: "" };
    }
    return undefined;
  }
  const key = line.slice(0, at);
  // Extracted field keys are bare identifiers, so anything else is body text.
  if (/[^\w.-]/.test(key)) return undefined;
  return { key, rest: line.slice(at + 2) };
}

/**
 * A tool block runs from a `⚙ <name>` header to the first blank line, the same
 * scope `formatHit` uses. Extraction dropped where each value's newlines were,
 * so a field is recognised heuristically — a declared key, unseen in this block;
 * tightening it further needs those boundaries from `textExtract`, not a sharper
 * guess here.
 */
export function decorateToolLines(
  lines: readonly string[],
): (LineDecoration | undefined)[] {
  const out: (LineDecoration | undefined)[] = new Array<undefined>(
    lines.length,
  ).fill(undefined);

  let inBlock = false;
  let profile: ToolProfile | undefined;
  let marker: string | undefined;
  let suppressing = false;
  let started = false;
  let seen = new Set<string>();

  for (const [i, line] of lines.entries()) {
    if (line.startsWith(TOOL_MARK)) {
      const name = line.slice(TOOL_MARK.length).trim();
      inBlock = true;
      profile = TOOL_PROFILES.get(name);
      marker = undefined;
      suppressing = false;
      started = false;
      seen = new Set();
      out[i] = { text: `[${name}]`, toolName: name, suppressed: true };
      continue;
    }
    if (!inBlock) continue;
    if (line === "") {
      inBlock = false;
      profile = undefined;
      marker = undefined;
      suppressing = false;
      continue;
    }

    const field = splitField(line);
    // A field starts a new value only once per block: a tool passes each
    // argument once, so a repeat is edited content that looks like one.
    if (
      field === undefined ||
      profile === undefined ||
      !profile.fields.has(field.key) ||
      seen.has(field.key)
    ) {
      if (marker !== undefined) out[i] = { text: `${marker} ${line}` };
      else if (suppressing) out[i] = { suppressed: true };
      continue;
    }

    seen.add(field.key);

    const diff = profile.diffMarkers.get(field.key);
    if (diff !== undefined) {
      marker = diff;
      started = true;
      suppressing = false;
      out[i] = { text: `${diff} ${field.rest}` };
      continue;
    }

    // Never once a value has started: hiding a line of content is the one
    // failure this layer must not have, so it only suppresses where it is sure.
    marker = undefined;
    suppressing = !started && profile.suppressed.has(field.key);
    out[i] = suppressing ? { suppressed: true } : undefined;
  }

  return out;
}
