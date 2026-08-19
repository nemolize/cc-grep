import { TOOL_MARK } from "./textExtract.js";

/**
 * Extraction stays verbatim so a search still reaches every field; this layer
 * only decides how those same lines are shown.
 */
export interface LineDecoration {
  /** Replaces the line's text. Undefined leaves it as extracted. */
  text?: string | undefined;
  /** Carries nothing a reader needs; each caller decides whether to hide it. */
  suppressed?: boolean | undefined;
  /** Set on the `⚙ <name>` header only, so a caller can lift the name away. */
  toolName?: string | undefined;
}

/**
 * Keyed by tool name, which is arbitrary transcript data — `Map` rather than an
 * object literal so a name like `constructor` cannot reach a prototype member.
 */
interface ToolProfile {
  /**
   * Fields whose value is noise, each with the values it may hold. A line only
   * matches when its value does too — a content line reusing the name does not.
   */
  suppressed: ReadonlyMap<string, ReadonlySet<string>>;
  /** Fields shown as a diff side rather than a `key: value` pair. */
  diffMarkers: ReadonlyMap<string, string>;
  /**
   * A key outside this set continues the previous value instead of starting a
   * field — edited file content routinely holds `key: value` lines of its own.
   */
  fields: ReadonlySet<string>;
}

const EDIT_PROFILE: ToolProfile = {
  suppressed: new Map([["replace_all", new Set(["true", "false"])]]),
  diffMarkers: new Map([
    ["old_string", "-"],
    ["new_string", "+"],
  ]),
  fields: new Set(["file_path", "old_string", "new_string", "replace_all"]),
};

/**
 * MultiEdit nests its strings inside an `edits` array, so none of Edit's fields
 * appear at the top level; sharing Edit's profile only ever matched content.
 */
const MULTI_EDIT_PROFILE: ToolProfile = {
  suppressed: new Map(),
  diffMarkers: new Map(),
  fields: new Set(["file_path", "edits"]),
};

const TOOL_PROFILES: ReadonlyMap<string, ToolProfile> = new Map([
  ["Edit", EDIT_PROFILE],
  ["MultiEdit", MULTI_EDIT_PROFILE],
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
 * scope `formatHit` uses. Extraction dropped where each value's newlines were —
 * and emits no separator between content blocks — so both a field and the block's
 * end are recognised heuristically. Tightening either needs those boundaries out
 * of `textExtract`, which is the change to make before adding another flag here.
 */
export function decorateToolLines(
  lines: readonly string[],
): (LineDecoration | undefined)[] {
  const out: (LineDecoration | undefined)[] = new Array<undefined>(
    lines.length,
  ).fill(undefined);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.startsWith(TOOL_MARK)) continue;
    const name = line.slice(TOOL_MARK.length).trim();
    out[i] = { text: `[${name}]`, toolName: name, suppressed: true };
    i = decorateBlock(lines, i + 1, TOOL_PROFILES.get(name), out);
  }

  return out;
}

/**
 * Decorate one block's argument lines and return the index of its last line.
 * The scan state is local, so it cannot outlive the block it describes.
 */
function decorateBlock(
  lines: readonly string[],
  start: number,
  profile: ToolProfile | undefined,
  out: (LineDecoration | undefined)[],
): number {
  let marker: string | undefined;
  let suppressing = false;
  let started = false;
  const seen = new Set<string>();

  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // A block ends at a blank line or the next call's header — but inside a
    // diff value a `⚙` is quoted data, so a live marker outranks that read.
    if (line === "") return i;
    if (line.startsWith(TOOL_MARK) && marker === undefined) return i - 1;

    const field = splitField(line);
    // A field starts a new value only once per block: a tool passes each
    // argument once, so a repeat is edited content that looks like one.
    if (
      field === undefined ||
      profile === undefined ||
      !profile.fields.has(field.key) ||
      seen.has(field.key)
    ) {
      // This line belongs to some value, so every later one does too.
      started = true;
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

    // Any earlier argument may run over several lines, so a name below one is
    // content — and hiding content is the one failure this layer must not have.
    marker = undefined;
    suppressing =
      !started && profile.suppressed.get(field.key)?.has(field.rest) === true;
    started = true;
    out[i] = suppressing ? { suppressed: true } : undefined;
  }

  return lines.length;
}
