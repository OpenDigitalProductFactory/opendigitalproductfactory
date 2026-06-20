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
}): Promise<string> {
  const idempotencyKey = `external-session:${args.externalSessionId}`;
  const objective =
    args.summary.trim().slice(0, 500)
    || `External ${args.provider} development session`;

  const capsule = await createWorkCapsule({
    db: args.db,
    input: {
      title: `${providerLabel(args.provider)} session ${args.externalSessionId}`.slice(0, 120),
      objective,
      source: "external-adoption",
      executorKind: providerToExecutorKind(args.provider),
      executorRef: args.externalSessionId,
      idempotencyKey,
    },
    actor: args.actor,
  });

  await recordWorkCapsuleEvidence({
    db: args.db,
    capsuleId: capsule.capsuleId,
    evidence: {
      kind: "note",
      summary: args.summary.trim().slice(0, 500) || "External development evidence recorded",
    },
    actor: args.actor,
  });

  return capsule.capsuleId;
}
