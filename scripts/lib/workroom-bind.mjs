// Bind a branch + worktree to a Workroom automatically (BI-0B292D84 layer 1).
//
// WHY THIS EXISTS
//   AGENTS.md §12 requires claiming a Workroom before you work, on every
//   surface. Measured on this install 2026-08-27, 31 of 91 live worktree
//   branches carried no binding at all — a 35% miss rate that had not moved
//   since the rule was written, because the rule asks a human or an agent to
//   REMEMBER something at exactly the moment they are thinking about
//   something else.
//
//   A guard that warns about the gap does not close it; it only makes the gap
//   audible. The gap closes when the claim happens as a side effect of the act
//   that creates the obligation — creating a worktree. That is what this does.
//
// WHAT IT GUARANTEES, AND WHAT IT DOES NOT
//   MCP stays the sole authority on whether a claim exists. This never invents
//   one: it calls the governed `adopt_worktree` tool, which is idempotent and
//   reuses a live capsule for the same branch rather than minting duplicates.
//   On success it caches the answer as the marker the claim guard reads.
//
//   Where MCP is unreachable or no token is configured, binding DEGRADES and
//   says so — it writes nothing and reports `unavailable`. It must never block
//   worktree creation, and it must never fabricate a marker for a claim that
//   does not exist, because the guard treats a marker as proof.

import fs from "node:fs";
import path from "node:path";

import { mcpCall } from "./mcp-client.mjs";

export const DEFAULT_MCP_ENDPOINT = "http://127.0.0.1:3000/api/mcp/v1";
/** Must match packages/dpf-skill-pack/hooks/lib/workroom-claim-lookup.mjs. */
export const CLAIM_MARKER_NAME = "dpf-workroom-claim.json";

/** Short: this runs inside worktree creation, which must not hang. */
export const BIND_TIMEOUT_MS = 8_000;

// ── pure planning (unit-tested without a network) ────────────────────────────

/** Forward-slash form, so a Windows path is recorded the way every other
 *  worktreePath in the substrate is. Split/join avoids a regex whose escape
 *  is easy to mangle when this file is generated or patched. */
export function toPosixPath(p) {
  return String(p ?? "").split("\\").join("/");
}

/**
 * A branch's intent prefix carries what kind of work it is. Reuse it rather
 * than asking, so binding needs no interaction.
 * @param {string} branch
 */
export function activityKindForBranch(branch) {
  const b = String(branch ?? "");
  if (b.startsWith("fix/") || b.startsWith("hotfix/")) return "remediation";
  if (b.startsWith("doc/") || b.startsWith("docs/")) return "governance";
  if (b.startsWith("chore/") || b.startsWith("clean/") || b.startsWith("refactor/")) return "improvement";
  return "delivery";
}

/**
 * Build the adopt_worktree arguments for a branch. Title and objective are
 * derived from the branch slug: honest placeholders that name the work rather
 * than pretending to a specificity nobody supplied.
 * @param {{ branch: string, worktreePath: string, repositoryFullName: string, headSha?: string|null, baseBranch?: string }} input
 */
export function planAdoption({ branch, worktreePath, repositoryFullName, headSha = null, baseBranch = "main" }) {
  const slug = String(branch).split("/").slice(1).join("/") || String(branch);
  const words = slug.replace(/[-_]+/g, " ").trim();
  const title = words ? words.charAt(0).toUpperCase() + words.slice(1) : branch;
  return {
    title,
    objective: `Work carried on ${branch}. Bound automatically at worktree creation; refine this objective when the work is scoped.`,
    repositoryFullName,
    headBranch: branch,
    worktreePath: toPosixPath(worktreePath),
    baseBranch,
    ...(headSha ? { headSha } : {}),
    executorKind: "claude-desktop",
    activityKind: activityKindForBranch(branch),
    decisionScope: "wwmd",
    portfolioRole: "foundational",
  };
}

/**
 * Reduce an adopt_worktree response to the marker the claim guard reads.
 * Returns null when the response carries no usable capsule — a missing
 * capsuleId or lease must never become a marker, because the guard treats a
 * marker as proof that a claim exists.
 * @param {any} payload
 * @param {string} branch
 */
export function markerFromAdoption(payload, branch) {
  // The wire shape is {success, message, entityId, data:{capsule}} — mcpCall
  // already unwraps the JSON-RPC envelope, but NOT the tool result's own
  // `data`. Reading payload.capsule directly matched the shape this function
  // was WRITTEN against and not the one the server sends, so every bind
  // reported "no usable capsule identity" while the claims were being created
  // correctly. The fallbacks keep older/other shapes working.
  const capsule = payload?.data?.capsule ?? payload?.capsule ?? payload?.data ?? payload;
  const capsuleId = typeof capsule?.capsuleId === "string" ? capsule.capsuleId : null;
  const leaseExpiresAt = typeof capsule?.leaseExpiresAt === "string" ? capsule.leaseExpiresAt : null;
  if (!capsuleId || !leaseExpiresAt || !Number.isFinite(Date.parse(leaseExpiresAt))) return null;
  return {
    capsuleId,
    branch,
    leaseExpiresAt,
    worktreePath: typeof capsule?.worktreePath === "string" ? capsule.worktreePath : null,
    backlogItemId: typeof capsule?.backlogItemId === "string" ? capsule.backlogItemId : null,
  };
}

/** Endpoint + token from the environment, or null when binding cannot run. */
export function resolveMcpAccess(env = process.env) {
  const bearerToken = env.DPF_MCP_BEARER_TOKEN;
  if (!bearerToken) return null;
  return { mcpUrl: env.DPF_MCP_ENDPOINT || DEFAULT_MCP_ENDPOINT, bearerToken };
}

// ── effectful ────────────────────────────────────────────────────────────────

/** Write the claim marker into the worktree's OWN git dir (never the shared one). */
export function writeClaimMarker(gitDir, marker) {
  fs.writeFileSync(path.join(gitDir, CLAIM_MARKER_NAME), JSON.stringify(marker), "utf8");
}

/**
 * Claim a Workroom for a branch and cache the answer as the guard's marker.
 *
 * Never throws: worktree creation must not fail because the coordination plane
 * is down. Every outcome is returned as data so the caller can report it —
 * silence is what let the 35% gap persist unnoticed in the first place.
 *
 * @returns {Promise<{status:'bound'|'unavailable'|'refused'|'error', capsuleId?:string, reason?:string}>}
 */
export async function bindWorktreeToWorkroom({
  branch,
  worktreePath,
  gitDir,
  repositoryFullName,
  headSha = null,
  baseBranch = "main",
  env = process.env,
  call = mcpCall,
  writeMarker = writeClaimMarker,
}) {
  const access = resolveMcpAccess(env);
  if (!access) return { status: "unavailable", reason: "DPF_MCP_BEARER_TOKEN is not set" };

  let payload;
  try {
    payload = await call("adopt_worktree", planAdoption({ branch, worktreePath, repositoryFullName, headSha, baseBranch }), {
      ...access,
      timeoutMs: BIND_TIMEOUT_MS,
    });
  } catch (err) {
    return { status: "unavailable", reason: err?.message ?? String(err) };
  }

  if (payload?.success === false || payload?.error) {
    // branch_occupied and friends are real answers, not failures to retry.
    return { status: "refused", reason: payload.message ?? payload.error ?? "adopt_worktree refused" };
  }

  const marker = markerFromAdoption(payload, branch);
  if (!marker) return { status: "error", reason: "adopt_worktree returned no usable capsule identity" };

  try {
    if (gitDir) writeMarker(gitDir, marker);
  } catch (err) {
    // The claim EXISTS; only the cache failed. Say so rather than reporting a
    // failure to bind — the guard will simply re-derive it.
    return { status: "bound", capsuleId: marker.capsuleId, reason: `claim recorded, marker not cached: ${err?.message ?? err}` };
  }
  return { status: "bound", capsuleId: marker.capsuleId };
}
