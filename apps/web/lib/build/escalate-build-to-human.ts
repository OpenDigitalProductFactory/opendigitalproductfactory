// apps/web/lib/build/escalate-build-to-human.ts
//
// BI-3E0EE3BA — capture + escalate-to-human + free WIP for builds Build Studio
// cannot self-repair.
//
// Why this exists:
//   A self-building platform sometimes CANNOT fix itself "for obvious reasons"
//   (the defect is in the dispatch path it runs on; a capability gap; a change
//   too large for the local model). BI-99B06AD1 added a bounded plan-review
//   fix loop; when even that is exhausted the build must not silently churn or
//   resume-restall forever. The honest outcome is to:
//     1. CAPTURE a durable, human-facing escalation record (root cause, what was
//        attempted, why blocked, and a self-fix-feasibility class);
//     2. RAISE it for attendance — reuse createPlatformIssueReport(). A self-fix
//        escalation is born in awaiting_escalation_ack and HELD for the
//        escalation responder (BI-0ACD9AB2 §5.2), NOT generic-projected into a
//        BI: the responder consults WWMD/WWWD/WSID and escalates only the
//        residue a human truly needs, so the signal is received, not drowned;
//     3. FREE the WIP slot — mark the build abandoned (wip-cap counts only
//        abandonedAt-null builds), so the jam clears;
//     4. RE-QUEUE without re-stalling — park the originating backlog item as
//        "deferred" (not "open", which would just auto-re-promote into the same
//        stall) so the work is never lost but waits for a human.
//
//   Recognizing "I can't fix this" is a first-class, learnable outcome — the
//   self-fix-feasibility class is consumed downstream by hive learning
//   (BI-76B4317F) and support-tier routing incl. resellers (BI-5090F4AA).
//
// This module keeps the formatting + classification PURE (trivially unit-tested)
// and isolates the DB side effects in escalateBuildToHuman(), each write
// best-effort and independently guarded so a reporting failure never blocks the
// WIP free-up.

import { prisma } from "@dpf/db";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import { notifyAttentionLive, resolveOperatorRecipient } from "@/lib/attention/notify-live";

/** Self-fix-feasibility class — why an autonomous producer could not self-repair. */
export const SELF_FIX_CLASS = {
  /** A retry / different route would likely succeed (handled automatically). */
  AUTO_RECOVERABLE: "auto-recoverable",
  /** Needs a human decision or change the platform cannot make on its own. */
  NEEDS_HUMAN: "needs-human",
  /** Needs capability/expertise/tools the customer install does not have
   *  (candidate for reseller/partner augmentation — BI-5090F4AA). */
  NEEDS_EXTERNAL_CAPABILITY: "needs-external-capability",
} as const;

export type SelfFixClass = (typeof SELF_FIX_CLASS)[keyof typeof SELF_FIX_CLASS];

/** Minimal shape of a blocking review issue (structurally matches PlanReviewIssue). */
export type EscalationIssue = { severity: string; description: string };

/** Stable idempotency key — one NON-RESOLVED escalation per build (partial-unique
 *  on PlatformIssueReport.dedupeKey WHERE status NOT IN resolved/suppressed, so it
 *  covers the awaiting_escalation_ack birth status). Re-escalation while one is
 *  still open/awaiting is a no-op; it re-files once the prior one is resolved. */
export function buildEscalationDedupeKey(buildId: string): string {
  return `build-escalation:${buildId}`;
}

const MAX_ISSUES_LISTED = 15;

/**
 * Render the durable escalation record's title + description. Pure.
 * Captures: which build/feature, what phase failed, what was attempted
 * (N revision rounds), the unresolved blocking issues (root cause), and the
 * self-fix-feasibility class so a human (or reseller) knows what kind of help
 * is needed.
 */
export function formatEscalationReport(args: {
  buildId: string;
  featureTitle: string;
  biTitle?: string | null;
  phase: string;
  rounds: number;
  issues: EscalationIssue[];
  selfFixClass: SelfFixClass;
}): { title: string; description: string } {
  const { buildId, featureTitle, biTitle, phase, rounds, issues, selfFixClass } = args;

  const subject = (biTitle?.trim() || featureTitle?.trim() || buildId).slice(0, 200);
  const title = `Build Studio needs you: "${subject}" stuck at ${phase} review`;

  const shown = issues.slice(0, MAX_ISSUES_LISTED);
  const issueLines = shown.length
    ? shown.map((i) => `- [${i.severity}] ${i.description}`).join("\n")
    : "- (no structured blocking issues were recorded)";
  const overflow =
    issues.length > shown.length ? `\n…and ${issues.length - shown.length} more.` : "";

  const roundsAttempted =
    rounds > 0
      ? `Build Studio attempted ${rounds} automated plan revision round(s), feeding the reviewer's blocking issues back into each one, and the reviewer still rejected the plan.`
      : `The plan review failed and no automated revision could be attempted.`;

  const description =
    `Build ${buildId} ("${subject}") could not be self-repaired by Build Studio ` +
    `and has been escalated for owner attention.\n\n` +
    `Phase: ${phase}\n` +
    `Self-fix feasibility: ${selfFixClass}\n\n` +
    `What was attempted:\n${roundsAttempted}\n\n` +
    `Unresolved blocking issues (root cause):\n${issueLines}${overflow}\n\n` +
    `The build's WIP slot has been freed (build marked abandoned) and the ` +
    `originating backlog item parked as "deferred" so the work is not lost — ` +
    `it awaits an owner (or reseller/partner) before it is re-promoted. ` +
    `(BI-3E0EE3BA)`;

  return { title, description };
}

export interface EscalateBuildArgs {
  /** FeatureBuild.id (cuid) — links the PlatformIssueReport via featureBuildId. */
  buildPk: string;
  /** FeatureBuild.buildId (FB-*) — used for featureBuild/buildActivity writes. */
  buildId: string;
  featureTitle: string;
  biTitle?: string | null;
  /** BacklogItem.id of the originating item, if any — parked as "deferred". */
  originatingBacklogItemId?: string | null;
  phase: string;
  rounds: number;
  issues: EscalationIssue[];
  selfFixClass?: SelfFixClass;
  log: (summary: string) => Promise<unknown> | unknown;
  now?: Date;
}

export interface EscalateBuildResult {
  reportId: string | null;
  wipFreed: boolean;
  backlogItemDeferred: boolean;
}

/**
 * Escalate a build Build Studio cannot self-repair: capture a durable issue
 * report, free the WIP slot, and park the backlog item. Side-effectful but
 * each step is independently guarded so a partial failure still frees WIP —
 * clearing the jam is the priority.
 */
export async function escalateBuildToHuman(args: EscalateBuildArgs): Promise<EscalateBuildResult> {
  const {
    buildPk,
    buildId,
    featureTitle,
    biTitle,
    originatingBacklogItemId,
    phase,
    rounds,
    issues,
    selfFixClass = SELF_FIX_CLASS.NEEDS_HUMAN,
    log,
    now = new Date(),
  } = args;

  const safeLog = async (m: string) => {
    try { await log(m); } catch { /* never throw from logging */ }
  };

  const { title, description } = formatEscalationReport({
    buildId, featureTitle, biTitle, phase, rounds, issues, selfFixClass,
  });

  // 1. CAPTURE + RAISE — durable report. A self-fix escalation (selfFixClass set)
  //    is born in awaiting_escalation_ack and held for the responder, NOT generic-
  //    projected (BI-0ACD9AB2 §5.2). Best-effort: a duplicate (per-dedupeKey "one
  //    non-resolved report" partial-unique) or any failure must not stop WIP free-up.
  let reportId: string | null = null;
  try {
    const r = await createPlatformIssueReport({
      type: "build-stall-escalation",
      source: "build-studio",
      severity: "high",
      title,
      description,
      featureBuildId: buildPk,
      triggerKind: `${phase}-review-exhausted`,
      dedupeKey: buildEscalationDedupeKey(buildId),
      selfFixClass,
    });
    reportId = r.reportId;
  } catch (err) {
    await safeLog(`Escalation report not filed (continuing to free WIP): ${String(err)}`.slice(0, 300));
  }

  // Attention spine (BI-094A124F): proactively tell the operator a new escalation
  // needs them. The "Needs you" inbox already shows it (re-homed off /ops); this
  // adds the bell + live refresh. Best-effort by contract — never blocks WIP free-up.
  if (reportId) {
    const recipient = await resolveOperatorRecipient();
    if (recipient) {
      await notifyAttentionLive({
        source: "escalation",
        itemKey: reportId,
        userId: recipient,
        title,
        deepLink: `/build?buildId=${encodeURIComponent(buildId)}`,
        riskClass: "high-risk",
      });
    }
  }

  // 2. FREE WIP — mark the build abandoned (mirrors the inert-build reaper). The
  //    WIP cap counts only abandonedAt-null builds, so this clears the slot.
  let wipFreed = false;
  try {
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        phase: "abandoned",
        abandonedAt: now,
        abandonReason:
          `Escalated to the owner after ${rounds} self-repair round(s) at ${phase} review ` +
          `(${selfFixClass})${reportId ? `; tracked as ${reportId}` : ""}. ` +
          `Freed a Build Studio WIP slot. (BI-3E0EE3BA)`,
        updatedAt: now,
      },
    });
    wipFreed = true;
    // BI-8BD61C30: tear down isolation worktree when escalating (same as self-abandon).
    const { releaseSandboxForTerminalBuild } = await import(
      "@/lib/build/sandbox/sandbox-build-gc"
    );
    await releaseSandboxForTerminalBuild(buildId, { deleteBranch: false }).catch(() => {});
  } catch (err) {
    await safeLog(`Failed to abandon build to free WIP: ${String(err)}`.slice(0, 300));
  }

  // 3. RE-QUEUE WITHOUT RE-STALLING — park the originating item as "deferred"
  //    and detach the (now-abandoned) build so it is not auto-re-promoted into
  //    the same stall. A human re-opens it once the escalation is resolved.
  let backlogItemDeferred = false;
  if (originatingBacklogItemId) {
    try {
      await prisma.backlogItem.update({
        where: { id: originatingBacklogItemId },
        data: { status: "deferred", activeBuildId: null, updatedAt: now },
      });
      backlogItemDeferred = true;
    } catch (err) {
      await safeLog(`Failed to park backlog item as deferred: ${String(err)}`.slice(0, 300));
    }
  }

  // 4. AUDIT — discriminated activity row (mirrors watchdog:reap-inert).
  try {
    await prisma.buildActivity.create({
      data: {
        buildId,
        tool: "build:escalate-human",
        summary:
          `Escalated to the owner (${selfFixClass}) after ${rounds} self-repair round(s) at ${phase} review` +
          `${reportId ? ` — ${reportId}` : ""}. WIP freed; backlog item parked.`,
      },
    });
  } catch { /* audit is best-effort */ }

  await safeLog(
    `Escalated to the owner: ${selfFixClass}${reportId ? ` (${reportId})` : ""}. ` +
    `WIP slot freed${backlogItemDeferred ? "; backlog item parked as deferred" : ""}.`,
  );

  return { reportId, wipFreed, backlogItemDeferred };
}
