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
//        stall) so the work is never lost but waits for a human. That park is
//        ATTRIBUTABLE: reason, trigger, review date and accountable owner, plus
//        a status_change row on the ITEM (not only a BuildActivity on the build
//        being abandoned). Without those four fields the item does not wait for
//        a human, it disappears from every sweep that would surface it — which
//        is what happened to seven items including BI-F0715C9C (BI-9DA5F179).
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
import {
  normalizeDeferralInput,
  type NormalizedDeferral,
} from "@/lib/backlog/deferral-contract";

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
 * How long an escalated item may wait before it comes due for review anyway.
 * The trigger (escalation resolved) is the normal way back; this is the
 * backstop for an escalation nobody ever answers, so the item resurfaces
 * instead of aging out of sight.
 */
export const ESCALATION_DEFERRAL_REVIEW_DAYS = 14;

/**
 * The deferral an escalation writes onto the originating backlog item.
 *
 * Pure, so the wording and the review window are testable without a database.
 * Routed through normalizeDeferralInput rather than building the columns by
 * hand: the governed path validates deferrals there, and a second, laxer
 * definition here is exactly how this write drifted out of conformance in the
 * first place (BI-9DA5F179).
 *
 * Returns null when there is no accountable owner. The caller must then NOT
 * park the item: a deferral with no owner and no trigger is not a park, it is a
 * disappearance — nothing fires, nothing comes due, and the item reads as
 * handled while being unreachable.
 */
export function buildEscalationDeferral(input: {
  buildId: string;
  phase: string;
  rounds: number;
  reportId: string | null;
  ownerPrincipalId: string | null;
  now: Date;
}): NormalizedDeferral | null {
  if (!input.ownerPrincipalId) return null;
  const reviewAt = new Date(
    input.now.getTime() + ESCALATION_DEFERRAL_REVIEW_DAYS * 24 * 60 * 60 * 1000,
  );
  const normalized = normalizeDeferralInput(
    {
      reason:
        `Build Studio could not self-repair build ${input.buildId} after ${input.rounds} ` +
        `round(s) at ${input.phase} review and escalated it to a human` +
        `${input.reportId ? `; tracked as ${input.reportId}` : ""}. ` +
        `The work is not lost — it waits for an owner rather than re-promoting into the same stall.`,
      trigger:
        `The escalation is answered${input.reportId ? ` (${input.reportId} resolved)` : ""}, ` +
        `so the blocking question has an answer and the item can be re-promoted.`,
      reviewAt: reviewAt.toISOString(),
      ownerPrincipalId: input.ownerPrincipalId,
    },
    input.now,
  );
  return normalized.ok ? normalized.value : null;
}

/**
 * Principal accountable for answering the escalation. Falls back to creating the
 * user's Principal rather than returning null, so a first-time operator does not
 * silently lose the item; null only when there is no operator at all.
 */
async function resolveEscalationOwnerPrincipalId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const alias = await prisma.principalAlias.findFirst({
      where: { aliasType: "user", aliasValue: userId },
      select: { principalId: true },
    });
    if (alias?.principalId) return alias.principalId;
    const { syncUserPrincipal } = await import("@/lib/identity/principal-linking");
    const synced = await syncUserPrincipal(userId);
    return synced?.id ?? null;
  } catch {
    return null;
  }
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
  // Resolved once: the same operator is both the notification recipient and the
  // principal accountable for the parked backlog item below. Two different
  // answers for "who owns this escalation" would be a bug.
  const operatorUserId = reportId ? await resolveOperatorRecipient() : null;

  if (reportId && operatorUserId) {
    await notifyAttentionLive({
      source: "escalation",
      itemKey: reportId,
      userId: operatorUserId,
      title,
      // Point at the durable escalation record, not at the build. Step 2 below
      // abandons that build microseconds from now, so `/build?buildId=` would
      // send the operator to a corpse (BI-B6894001). The report survives and
      // carries the root cause, what was attempted, and the blocking issues.
      deepLink: "/admin/issue-reports",
      riskClass: "high-risk",
    });
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
      const existing = await prisma.backlogItem.findUnique({
        where: { id: originatingBacklogItemId },
        select: { status: true },
      });
      const deferral = buildEscalationDeferral({
        buildId,
        phase,
        rounds,
        reportId,
        ownerPrincipalId: await resolveEscalationOwnerPrincipalId(operatorUserId),
        now,
      });
      if (!deferral) {
        // Fail loudly rather than parking the item unattributably. An item with
        // no owner and no trigger is worse than one left in its current state:
        // it looks handled and is unreachable.
        await safeLog(
          "Backlog item NOT parked: could not resolve an accountable owner principal for the deferral.",
        );
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.backlogItem.update({
            where: { id: originatingBacklogItemId },
            data: {
              status: "deferred",
              activeBuildId: null,
              updatedAt: now,
              deferredAt: now,
              ...deferral,
            },
          });
          await tx.backlogItemActivity.create({
            data: {
              backlogItemId: originatingBacklogItemId,
              kind: "status_change",
              summary: `${existing?.status ?? "unknown"} → deferred`,
              payload: {
                from: existing?.status ?? null,
                to: "deferred",
                escalatedBuildId: buildId,
                escalationReportId: reportId,
                deferral: {
                  reason: deferral.deferReason,
                  trigger: deferral.deferTrigger,
                  reviewAt: deferral.deferReviewAt.toISOString(),
                  ownerPrincipalId: deferral.deferOwnerPrincipalId,
                },
              },
            },
          });
        });
        backlogItemDeferred = true;
      }
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
