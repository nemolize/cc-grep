import { join } from "node:path";

import type { TranscriptSource } from "./types.js";

interface SourceProfile {
  homeSegments: string[];
  rootEnv: string;
}

const PROFILES: Record<TranscriptSource, SourceProfile> = {
  claude: {
    homeSegments: [".claude", "projects"],
    rootEnv: "CC_GREP_ROOT",
  },
  codex: {
    homeSegments: [".codex", "sessions"],
    rootEnv: "CC_GREP_CODEX_ROOT",
  },
};

export const ALL_SOURCES: readonly TranscriptSource[] = ["claude", "codex"];

export function sourceRoot(
  source: TranscriptSource,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const profile = PROFILES[source];
  const override = env[profile.rootEnv];
  if (override !== undefined && override.length > 0) return override;
  return join(home, ...profile.homeSegments);
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
