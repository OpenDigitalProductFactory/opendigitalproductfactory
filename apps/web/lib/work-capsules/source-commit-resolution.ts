import type { ToolResult } from "@/lib/mcp-tool-types";

/**
 * BI-DF34D948: a caller naturally holds a short SHA (`git log --oneline`), and
 * refusing it cost 43 retries across 28 sessions. The server expands a prefix
 * the repository provider resolves to exactly one commit, and refuses only an
 * ambiguous or unknown one, naming the candidates it knows and the exact call
 * that would succeed.
 */

const FULL_SHA = /^[0-9a-f]{40}$/i;
const PREFIX = /^[0-9a-f]+$/i;
/** git's own default abbreviation; anything shorter is too likely to collide. */
export const MIN_SHORT_SHA_LENGTH = 7;

export type ProviderCommitLookup = (prefix: string) => Promise<
  | { kind: "found"; sha: string }
  | { kind: "not-found" }
  | { kind: "unavailable" }
>;

export type SourceCommitResolverDeps = {
  /** The repository provider's answer for one prefix (GitHub: GET /commits/{ref}). */
  lookupProviderCommit: ProviderCommitLookup;
  /** Full SHAs this installation already recorded that start with the prefix. */
  recordedCandidates: (prefix: string) => Promise<string[]>;
};

type ShaField = "baseSha" | "headSha";

export type SourceCommitRefusalReason = "malformed" | "ambiguous" | "unknown" | "unavailable";

export type SourceCommitResolution =
  | { ok: true; baseSha: string | null; headSha: string | null; expanded: Array<{ field: ShaField; supplied: string; resolved: string }> }
  | { ok: false; field: ShaField; supplied: string; reason: SourceCommitRefusalReason; candidates: string[] };

async function resolveOne(field: ShaField, raw: unknown, deps: SourceCommitResolverDeps) {
  const supplied = typeof raw === "string" ? raw.trim() : String(raw);
  if (typeof raw !== "string" || !PREFIX.test(supplied) || supplied.length > 40
    || (supplied.length < MIN_SHORT_SHA_LENGTH)) {
    return { ok: false as const, field, supplied, reason: "malformed" as const, candidates: [] };
  }
  if (FULL_SHA.test(supplied)) return { ok: true as const, sha: supplied, expanded: false };
  const prefix = supplied.toLowerCase();
  const provider = await deps.lookupProviderCommit(prefix);
  if (provider.kind === "found" && FULL_SHA.test(provider.sha) && provider.sha.toLowerCase().startsWith(prefix)) {
    return { ok: true as const, sha: provider.sha.toLowerCase(), expanded: true };
  }
  // GitHub answers 422 for an ambiguous prefix and an unknown one alike, so the
  // candidates come from what this installation has already recorded.
  const candidates = [...new Set((await deps.recordedCandidates(prefix))
    .map((sha) => sha.toLowerCase())
    .filter((sha) => FULL_SHA.test(sha) && sha.startsWith(prefix)))];
  const reason = provider.kind === "unavailable" ? "unavailable" : candidates.length > 1 ? "ambiguous" : "unknown";
  return { ok: false as const, field, supplied, reason, candidates } as const;
}

/** Omitted fields stay null; full SHAs pass through untouched; prefixes are expanded or refused. */
export async function resolveSourceCommitShas(
  input: { baseSha?: unknown; headSha?: unknown },
  deps: SourceCommitResolverDeps,
): Promise<SourceCommitResolution> {
  const resolved: { baseSha: string | null; headSha: string | null } = { baseSha: null, headSha: null };
  const expanded: Array<{ field: ShaField; supplied: string; resolved: string }> = [];
  for (const field of ["baseSha", "headSha"] as const) {
    if (input[field] == null) continue;
    const one = await resolveOne(field, input[field], deps);
    if (!one.ok) return one;
    resolved[field] = one.sha;
    if (one.expanded) expanded.push({ field, supplied: (input[field] as string).trim(), resolved: one.sha });
  }
  return { ok: true, ...resolved, expanded };
}

/**
 * Build the provider-backed deps only when a prefix actually needs expanding,
 * so a full or omitted SHA never touches the network or the database.
 */
export function lazyResolverDeps(
  factory: ((repositoryFullName: string) => Promise<SourceCommitResolverDeps>) | undefined,
  repositoryFullName: string,
): SourceCommitResolverDeps {
  let deps: Promise<SourceCommitResolverDeps> | null = null;
  const load = () => deps ??= (factory
    ?? (async (repo: string) => (await import("./source-commit-provider")).defaultSourceCommitResolverDeps(repo)))(repositoryFullName);
  return {
    lookupProviderCommit: async (prefix) => (await load()).lookupProviderCommit(prefix),
    recordedCandidates: async (prefix) => (await load()).recordedCandidates(prefix),
  };
}

/** `tool({...})` with stable key order: the literal call a caller can paste back. */
export function workedCall(tool: string, args: Record<string, unknown>): string {
  return `${tool}(${JSON.stringify(args)})`;
}

/**
 * The refusal for a SHA that could not be resolved, carrying the corrected call.
 * `call.args` is the caller's own arguments; only the refused field is replaced.
 */
export function sourceCommitRefusal(
  failure: Extract<SourceCommitResolution, { ok: false }>,
  call: {
    tool: string;
    args: Record<string, unknown>;
    /** Where the SHA sits when it is not a top-level argument (an artifactRef's commit). */
    withValue?: (value: string) => Record<string, unknown>;
    label?: string;
  },
): ToolResult {
  const { supplied, reason, candidates } = failure;
  const field = call.label ?? failure.field;
  const placeholder = `<40-hex output of git rev-parse ${reason === "malformed" ? "HEAD" : supplied}>`;
  const retry = (value: string) => workedCall(call.tool, call.withValue ? call.withValue(value) : { ...call.args, [field]: value });
  let message: string;
  if (reason === "malformed") {
    message = `${field} "${supplied}" is not a commit SHA. Pass the full 40-character SHA or a prefix of at least ${MIN_SHORT_SHA_LENGTH} hex characters, or omit it before the first commit. Retry: ${retry(placeholder)}`;
  } else if (candidates.length > 1) {
    message = `${field} "${supplied}" matches more than one commit: ${candidates.join(", ")}. Retry with the one you mean, for example: ${retry(candidates[0]!)}`;
  } else if (candidates.length === 1) {
    message = `${field} "${supplied}" is not on the repository provider${reason === "unavailable" ? " (provider unreachable)" : " (an unpushed commit cannot be expanded server-side)"}; the only commit this installation recorded with that prefix is ${candidates[0]}. If that is the one, retry: ${retry(candidates[0]!)}`;
  } else {
    message = `${field} "${supplied}" ${reason === "unavailable" ? "could not be expanded: the repository provider is unreachable" : "matches no commit on the repository provider (an unpushed commit cannot be expanded server-side)"}. Run git rev-parse ${supplied} in the worktree and retry with the full SHA: ${retry(placeholder)}`;
  }
  return { success: false, error: "invalid_input", message, data: { field, supplied, reason, candidates } };
}
