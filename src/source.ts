import { join } from "node:path";

import type { ResolvedRoot, TranscriptSource } from "./types.js";

interface SourceProfile {
  homeSegments: string[];
  /** The legacy `CC_GREP_*` names keep pre-rename shell profiles working. */
  rootEnvs: readonly string[];
}

const PROFILES: Record<TranscriptSource, SourceProfile> = {
  claude: {
    homeSegments: [".claude", "projects"],
    rootEnvs: ["CG_ROOT", "CC_GREP_ROOT"],
  },
  codex: {
    homeSegments: [".codex", "sessions"],
    rootEnvs: ["CG_CODEX_ROOT", "CC_GREP_CODEX_ROOT"],
  },
};

export const ALL_SOURCES: readonly TranscriptSource[] = ["claude", "codex"];

function resolveRoot(
  source: TranscriptSource,
  env: NodeJS.ProcessEnv,
  home: string,
): ResolvedRoot {
  const profile = PROFILES[source];
  for (const name of profile.rootEnvs) {
    const override = env[name];
    if (override !== undefined && override.length > 0) {
      return { path: override, namedBy: name };
    }
  }
  return { path: join(home, ...profile.homeSegments) };
}

/** One flag per source, mirroring the env pair, so neither has to mean different things in different runs. */
const ROOT_FLAGS: Record<TranscriptSource, string> = {
  claude: "--root",
  codex: "--codex-root",
};

export function resolveRoots(
  sources: readonly TranscriptSource[],
  flags: Partial<Record<TranscriptSource, string | undefined>>,
  env: NodeJS.ProcessEnv,
  home: string,
): Map<TranscriptSource, ResolvedRoot> {
  return new Map(
    sources.map((source) => {
      const named = flags[source];
      return [
        source,
        named === undefined
          ? resolveRoot(source, env, home)
          : { path: named, namedBy: ROOT_FLAGS[source] },
      ];
    }),
  );
}

/** Printed rather than run, so an absent CLI costs a failed command and never a session reopened under the wrong agent. */
export function resumeCommandFor(
  source: TranscriptSource,
  sessionId: string,
): string {
  return source === "codex"
    ? `codex resume ${sessionId}`
    : `claude --resume ${sessionId}`;
}
