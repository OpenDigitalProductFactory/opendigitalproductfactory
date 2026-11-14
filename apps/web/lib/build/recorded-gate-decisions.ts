// apps/web/lib/build/recorded-gate-decisions.ts
//
// BI-BA6EDCDD: create_portal_pr publishes one platform-authored commit and the
// automatic PR path passes no readiness decisions, so the decisions a build's
// coding agent recorded as commit trailers (Convergence-Impact, Design-Grounding,
// Docs-Impact, ...) never reached the PR body. The published-tree readiness then
// refused the same gates on every hourly retry: FB-533EC6E2, 98 refusals from
// 2026-11-05, with all three decisions sitting in its own commit ad4962737.
//
// This carries those recorded decisions into the PR body. It only copies what
// the build's commits say; it never writes a decision itself. Attestations
// (Local-CI-*) and retired trailers are never carried.

import { PR_TRAILER_NAMES } from "../../../../scripts/lib/pr-trailer-contract.mjs";

/** Decision trailers a build records for itself, in the contract's order. */
export const CARRIED_DECISION_TRAILERS: readonly string[] = [
  PR_TRAILER_NAMES.processSpine,
  PR_TRAILER_NAMES.seedFit,
  PR_TRAILER_NAMES.designGrounding,
  PR_TRAILER_NAMES.docsImpact,
  PR_TRAILER_NAMES.convergenceImpact,
];

/** Separates commit bodies in the log output (%x1e, ASCII record separator). */
const RECORD_SEPARATOR = "\x1e";
const MAX_COMMITS = 200;
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_WORKDIR = /^\/workspace(\/\.builds\/[A-Za-z0-9_-]+)?$/;

function decisionLines(text: string): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = TRAILER_LINE.exec(raw.trim());
    if (!match) continue;
    const value = match[2]!.trim();
    if (value) lines.push([match[1]!, value]);
  }
  return lines;
}

/**
 * The decision trailers recorded in a git log of commit bodies (newest first,
 * separated by %x1e). The newest commit's value wins per trailer name; within
 * one commit the last line wins, as git's own trailer parsing does.
 */
export function extractRecordedGateDecisions(log: string): string {
  const carried = new Set(CARRIED_DECISION_TRAILERS);
  const chosen = new Map<string, string>();
  for (const body of log.split(RECORD_SEPARATOR)) {
    const inCommit = new Map<string, string>();
    for (const [name, value] of decisionLines(body)) {
      if (carried.has(name)) inCommit.set(name, value);
    }
    for (const [name, value] of inCommit) {
      if (!chosen.has(name)) chosen.set(name, value);
    }
  }
  return CARRIED_DECISION_TRAILERS
    .filter((name) => chosen.has(name))
    .map((name) => `${name}: ${chosen.get(name)}`)
    .join("\n");
}

/** Explicit decisions first; a recorded decision of the same name is dropped. */
export function mergeReadinessDecisions(explicit: string, recorded: string): string {
  const head = explicit.trim();
  const named = new Set(decisionLines(head).map(([name]) => name));
  const rest = recorded
    .split("\n")
    .filter((line) => line.trim())
    .filter((line) => {
      const match = TRAILER_LINE.exec(line.trim());
      return !match || !named.has(match[1]!);
    });
  return [head, ...rest].filter(Boolean).join("\n");
}

/**
 * The build's own commit bodies ahead of its base, excluding anything already
 * on upstream main (the same range buildOwnCommitsLogCommand counts).
 */
export function buildRecordedDecisionsLogCommand(workdir: string, baseRef: string): string {
  if (!SAFE_WORKDIR.test(workdir)) throw new Error("Decision workdir must be the sandbox workspace or a build worktree.");
  if (!SAFE_REF.test(baseRef) || baseRef.includes("..")) throw new Error("Decision base ref is not a safe Git ref.");
  return `cd '${workdir}' && _dpf_up=""; git rev-parse --verify --quiet origin/main >/dev/null && _dpf_up="^origin/main"; `
    + `git log --no-merges -n ${MAX_COMMITS} --format='%B%x1e' '${baseRef}'..HEAD $_dpf_up`;
}

/**
 * The readiness decisions for a build's PR body: the caller's explicit ones,
 * plus any the build's own commits recorded. A sandbox that cannot be read
 * leaves the explicit decisions as they are; nothing is guessed.
 */
export async function resolvePublicationReadinessDecisions(input: {
  explicit: unknown;
  containerId: string | null;
  workdir: string;
  baseRef: string;
  exec: (containerId: string, command: string) => Promise<string>;
}): Promise<string> {
  const explicit = typeof input.explicit === "string" ? input.explicit.trim() : "";
  if (!input.containerId) return explicit;
  try {
    const log = await input.exec(input.containerId, buildRecordedDecisionsLogCommand(input.workdir, input.baseRef));
    return mergeReadinessDecisions(explicit, extractRecordedGateDecisions(log));
  } catch {
    return explicit;
  }
}

/** create_portal_pr's entry: the build's worktree, read against its client base. */
export async function readBuildPublicationDecisions(input: {
  buildId: string;
  sandboxId: string | null;
  explicit: unknown;
}): Promise<string> {
  const explicit = typeof input.explicit === "string" ? input.explicit.trim() : "";
  if (!input.sandboxId) return explicit;
  try {
    const { getClientIdentity, resolveBuildWorkdir } = await import("./sandbox/build-branch");
    const { execInSandbox } = await import("./sandbox/sandbox");
    return await resolvePublicationReadinessDecisions({
      explicit,
      containerId: input.sandboxId,
      workdir: resolveBuildWorkdir(input.buildId),
      baseRef: (await getClientIdentity()).clientBranch,
      exec: execInSandbox,
    });
  } catch {
    return explicit;
  }
}
