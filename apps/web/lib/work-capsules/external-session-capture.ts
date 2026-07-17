// Durable auto-capture of external-agent work into a tracked WorkCapsule.
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

/**
 * Ensure the external session is a tracked WorkCapsule and append this evidence
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
 * BI-5FDBF786: ensure an external session is a tracked WorkCapsule at WORK
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
}): Promise<string> {
  const idempotencyKey = `external-session:${args.externalSessionId}`;
  const objective =
    args.summary?.trim().slice(0, 500)
    || `External ${args.provider} development session`;
  const title = `${providerLabel(args.provider)} session ${args.externalSessionId}`.slice(0, 120);
  const backlogItemId = args.backlogItemId?.trim() || null;
  const worktreePath = args.worktreePath?.trim() || null;
  const branchName = args.branchName?.trim() || null;

  // Prefer the adopt path when we have a location: it keys the capsule on
  // (repo, branch) so the session's BI, worktree, and branch are one record —
  // and late-binds the BI if the branch was already adopted without one.
  if (worktreePath && branchName) {
    const capsule = await adoptWorktreeCapsule({
      db: args.db,
      input: {
        title,
        objective,
        repositoryFullName:
          args.repositoryFullName?.trim() ||
          process.env.DPF_REPO_FULL_NAME?.trim() ||
          "OpenDigitalProductFactory/opendigitalproductfactory",
        headBranch: branchName,
        worktreePath,
        baseBranch: args.baseBranch?.trim() || "main",
        executorKind: providerToExecutorKind(args.provider),
        executorRef: args.externalSessionId,
        backlogItemId,
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
