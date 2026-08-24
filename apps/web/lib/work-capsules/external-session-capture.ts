// Durable auto-capture of external-agent work into a tracked Workroom.
//
// EP-UNIFIED-TRACKING / BI-636A11B3. The cross-surface activity view renders
// WorkCapsules. External agents (Claude Code / Codex / Grok) that work "directly"
// and never claim a capsule are therefore invisible — exactly the gap behind
// "I don't see the threads we have open here." This makes the act an external
// agent IS expected to do — record evidence (AGENTS.md §17) — also the capture
// trigger: recording evidence ensures the session is a tracked capsule, with no
// manual adopt_worktree. Idempotent per externalSessionId; the caller invokes it
// best-effort so it never blocks the evidence write.

import {
  adoptWorktreeCapsule,
  createWorkCapsule,
  recordWorkCapsuleEvidence,
  type CapsuleDb,
  type WorkCapsuleActor,
} from "./work-capsule-store";
import type { WorkCapsuleExecutorKind } from "@/lib/work-capsules";
import { defaultPlatformRepositoryFullName } from "./work-capsule-branch-identity";
import {
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";

/** Map a self-declared provider string to the closest desktop executor kind. */
export function providerToExecutorKind(provider: string): WorkCapsuleExecutorKind {
  const normalized = provider.trim().toLowerCase();
  if (normalized.includes("claude")) return "claude-desktop";
  if (normalized.includes("codex")) return "codex-desktop";
  if (normalized.includes("grok")) return "grok-desktop";
  if (normalized.includes("antigravity")) return "antigravity-desktop";
  return "human";
}

function providerLabel(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) return "External agent";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export async function resolvePublishedBranchHead(args: {
  repositoryFullName: string;
  branchName: string;
  expectedCommitSha: string;
  db: CapsuleDb;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/i.test(args.expectedCommitSha)) return null;
  const identity = await resolveRepoIdentity(args.db as never);
  const canonical = `${identity.owner}/${identity.name}`;
  if (canonical.toLowerCase() !== args.repositoryFullName.toLowerCase()) return null;
  const token = await resolveGithubToken(args.db as never);
  const response = await (args.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}/git/ref/heads/${encodeURIComponent(args.branchName)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  const payload = await response.json() as { object?: { type?: unknown; sha?: unknown } };
  const sha = payload.object?.type === "commit" && typeof payload.object.sha === "string"
    ? payload.object.sha.toLowerCase()
    : null;
  return sha === args.expectedCommitSha.toLowerCase() ? sha : null;
}

/**
 * Ensure the external session is a tracked Workroom and append this evidence
 * to its timeline. Returns the capsule's semantic id (WC-*). Idempotent: repeated
 * evidence from the same `externalSessionId` reuses one capsule.
 */
export async function captureExternalSessionEvidence(args: {
  db: CapsuleDb;
  externalSessionId: string;
  provider: string;
  summary: string;
  actor: WorkCapsuleActor;
  /**
   * BI-7D20BFDF: bind the direct-agent evidence record to a BacklogItem even
   * without a buildId (the "direct-agent gap"). When worktreePath + branchName
   * are also supplied we prefer the adopt path so the capsule carries the
   * location too (BI ↔ work-location binding); otherwise the BI is bound on the
   * createWorkCapsule path.
   */
  backlogItemId?: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  repositoryFullName?: string | null;
  baseBranch?: string | null;
  publishedCommitSha?: string | null;
  resolvePublishedHead?: typeof resolvePublishedBranchHead;
}): Promise<string> {
  const capsuleId = await ensureExternalSessionCapsule(args);

  await recordWorkCapsuleEvidence({
    db: args.db,
    capsuleId,
    evidence: {
      kind: "note",
      summary: args.summary.trim().slice(0, 500) || "External development evidence recorded",
    },
    actor: args.actor,
  });

  return capsuleId;
}

/**
 * BI-5FDBF786: ensure an external session is a tracked Workroom at WORK
 * START — before any evidence is recorded. captureExternalSessionEvidence
 * fires on first evidence (after work); this is the pure start signal so an
 * external agent (Claude/Codex/Grok/opencode) that has started but not yet
 * reported is not invisible. Idempotent per externalSessionId (create path) or
 * per (repo, branch) (adopt path). `summary` is optional — a starting session
 * need not describe an outcome yet.
 */
export async function ensureExternalSessionCapsule(args: {
  db: CapsuleDb;
  externalSessionId: string;
  provider: string;
  actor: WorkCapsuleActor;
  summary?: string | null;
  backlogItemId?: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  repositoryFullName?: string | null;
  baseBranch?: string | null;
  publishedCommitSha?: string | null;
  resolvePublishedHead?: typeof resolvePublishedBranchHead;
}): Promise<string> {
  const idempotencyKey = `external-session:${args.externalSessionId}`;
  const objective =
    args.summary?.trim().slice(0, 500)
    || `External ${args.provider} development session`;
  const title = `${providerLabel(args.provider)} session ${args.externalSessionId}`.slice(0, 120);
  const backlogItemId = args.backlogItemId?.trim() || null;
  const worktreePath = args.worktreePath?.trim() || null;
  const branchName = args.branchName?.trim() || null;
  const repositoryFullName =
    args.repositoryFullName?.trim() || defaultPlatformRepositoryFullName();
  let headSha: string | null = null;
  if (args.publishedCommitSha) {
    if (!branchName) throw new Error("Published commit reconciliation requires the governed branch name.");
    headSha = await (args.resolvePublishedHead ?? resolvePublishedBranchHead)({
      repositoryFullName,
      branchName,
      expectedCommitSha: args.publishedCommitSha,
      db: args.db,
    });
    if (!headSha) throw new Error("The repository provider did not verify the published commit as the governed branch head.");
  }

  // Prefer the adopt path when we have a location: it keys the capsule on
  // (repo, branch) so the session's BI, worktree, and branch are one record —
  // and late-binds the BI if the branch was already adopted without one.
  if (worktreePath && branchName) {
    const capsule = await adoptWorktreeCapsule({
      db: args.db,
      input: {
        title,
        objective,
        repositoryFullName,
        headBranch: branchName,
        worktreePath,
        baseBranch: args.baseBranch?.trim() || "main",
        executorKind: providerToExecutorKind(args.provider),
        executorRef: args.externalSessionId,
        backlogItemId,
        headSha,
      },
      actor: args.actor,
    });
    return capsule.capsuleId;
  }

  const capsule = await createWorkCapsule({
    db: args.db,
    input: {
      title,
      objective,
      source: "external-adoption",
      executorKind: providerToExecutorKind(args.provider),
      executorRef: args.externalSessionId,
      idempotencyKey,
      backlogItemId,
    },
    actor: args.actor,
  });
  return capsule.capsuleId;
}
