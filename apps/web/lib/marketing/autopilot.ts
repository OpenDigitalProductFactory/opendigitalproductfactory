// Marketing execution loop — bounded autopilot.
//
// Phase 5: when an OutboundAutopilotPolicy is enabled for a channel and an
// approved draft sits in the queue past `autoPublishAfterMinutes`, the
// runtime can auto-approve it (writing the OutboundApprovalDecision row
// as if the operator clicked Approve). That auto-approval flips the draft
// to approved and lets the existing publish path fire.
//
// Bounds, all enforced:
//   1. Channel allowlist (linkedin-personal-social + email-postmark only).
//      Ad channels (linkedin-ads) are HARD-REFUSED regardless of policy.
//      Inbound-reply drafts (sourceType=inbound-channel-message) are
//      ALWAYS gated by human approval — autopilot won't touch them.
//   2. Word count under `autoApproveBelowWords`.
//   3. Weekly per-channel publish count under `weeklyCeiling`.
//   4. Confidence flag in the draft body — bodies containing markers
//      like "[low confidence]" or "[needs review]" are refused.

import { prisma } from "@dpf/db";
import { isAutopilotAllowedChannel } from "./execution";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const LOW_CONFIDENCE_MARKERS = [
  /\[low\s*confidence\]/i,
  /\[needs\s*review\]/i,
  /\[draft\s*-\s*revise\]/i,
];

export type AutopilotEligibilityResult =
  | { ok: true; reasons: string[] }
  | { ok: false; reason: string };

export type AutopilotPolicy = {
  policyId: string;
  organizationId: string;
  channelId: string;
  enabled: boolean;
  autoApproveBelowWords: number | null;
  autoPublishAfterMinutes: number | null;
  weeklyCeiling: number;
  enabledByUserId: string;
};

export type DraftLike = {
  draftId: string;
  organizationId: string;
  channelId: string;
  sourceType: string;
  status: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function isAutopilotEligible(
  draft: DraftLike,
  policy: AutopilotPolicy,
  now: Date = new Date(),
): Promise<AutopilotEligibilityResult> {
  if (!policy.enabled) {
    return { ok: false, reason: "policy_disabled" };
  }
  if (draft.organizationId !== policy.organizationId) {
    return { ok: false, reason: "policy_org_mismatch" };
  }
  if (draft.channelId !== policy.channelId) {
    return { ok: false, reason: "policy_channel_mismatch" };
  }
  if (!isAutopilotAllowedChannel(draft.channelId)) {
    return { ok: false, reason: `channel_not_in_autopilot_allowlist: ${draft.channelId}` };
  }
  if (draft.sourceType === "inbound-channel-message") {
    return { ok: false, reason: "inbound_replies_never_autopiloted" };
  }
  if (draft.status !== "pending-review") {
    return { ok: false, reason: `draft_not_pending_review: ${draft.status}` };
  }

  // Word count bound (when policy sets one).
  if (policy.autoApproveBelowWords !== null) {
    const wordCount = countWords(draft.body);
    if (wordCount >= policy.autoApproveBelowWords) {
      return {
        ok: false,
        reason: `word_count_${wordCount}_at_or_above_threshold_${policy.autoApproveBelowWords}`,
      };
    }
  }

  // Confidence flag check.
  for (const marker of LOW_CONFIDENCE_MARKERS) {
    if (marker.test(draft.body)) {
      return { ok: false, reason: "draft_contains_confidence_flag" };
    }
  }

  // Aging gate: only fire after the policy's autoPublishAfterMinutes window
  // has elapsed since the draft's most recent update.
  if (policy.autoPublishAfterMinutes !== null) {
    const ageMinutes = (now.getTime() - new Date(draft.updatedAt).getTime()) / 60_000;
    if (ageMinutes < policy.autoPublishAfterMinutes) {
      return {
        ok: false,
        reason: `draft_not_aged: ${Math.floor(ageMinutes)}m < ${policy.autoPublishAfterMinutes}m`,
      };
    }
  }

  // Weekly publish ceiling — count publications already fired on this
  // channel in the rolling 7-day window.
  const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const weekPublishCount = await prisma.outboundPublication.count({
    where: { channelId: policy.channelId, publishedAt: { gte: weekStart, lte: now } },
  });
  if (weekPublishCount >= policy.weeklyCeiling) {
    return {
      ok: false,
      reason: `weekly_ceiling_reached: ${weekPublishCount} >= ${policy.weeklyCeiling}`,
    };
  }

  return {
    ok: true,
    reasons: [
      `channel_allowed:${draft.channelId}`,
      `word_count_under_threshold`,
      `aging_satisfied`,
      `weekly_publish_count:${weekPublishCount}_of_${policy.weeklyCeiling}`,
    ],
  };
}

export async function autopilotApprove(input: {
  draftId: string;
  policyId: string;
}): Promise<
  | { ok: true; decisionId: string }
  | { ok: false; reason: string }
> {
  const draft = await prisma.outboundDraft.findUnique({
    where: { draftId: input.draftId },
  });
  if (!draft) return { ok: false, reason: "draft_not_found" };

  const policy = await prisma.outboundAutopilotPolicy.findUnique({
    where: { policyId: input.policyId },
  });
  if (!policy) return { ok: false, reason: "policy_not_found" };

  const eligibility = await isAutopilotEligible(draft as DraftLike, policy as AutopilotPolicy);
  if (!eligibility.ok) return eligibility;

  const decision = await prisma.$transaction(async (tx) => {
    const d = await tx.outboundApprovalDecision.create({
      data: {
        draftId: draft.draftId,
        reviewerUserId: policy.enabledByUserId,
        decision: "approved",
        notes: `Auto-approved by policy ${policy.policyId}; reasons: ${eligibility.reasons.join(", ")}`,
      },
      select: { decisionId: true },
    });
    await tx.outboundDraft.update({
      where: { draftId: draft.draftId },
      data: { status: "approved" },
    });
    return d;
  });

  return { ok: true, decisionId: decision.decisionId };
}

export async function setAutopilotPolicy(input: {
  organizationId: string;
  channelId: string;
  enabled: boolean;
  autoApproveBelowWords: number | null;
  autoPublishAfterMinutes: number | null;
  weeklyCeiling: number;
  userId: string;
}): Promise<{ ok: true; policyId: string } | { ok: false; error: string }> {
  if (!isAutopilotAllowedChannel(input.channelId)) {
    return {
      ok: false,
      error: `channel_not_autopilot_eligible: ${input.channelId}. Ad channels are hard-refused by design.`,
    };
  }
  if (input.weeklyCeiling < 0) {
    return { ok: false, error: "weeklyCeiling must be >= 0" };
  }
  if (input.autoApproveBelowWords !== null && input.autoApproveBelowWords < 1) {
    return { ok: false, error: "autoApproveBelowWords must be >= 1 when set" };
  }
  if (input.autoPublishAfterMinutes !== null && input.autoPublishAfterMinutes < 0) {
    return { ok: false, error: "autoPublishAfterMinutes must be >= 0 when set" };
  }

  const row = await prisma.outboundAutopilotPolicy.upsert({
    where: {
      organizationId_channelId: {
        organizationId: input.organizationId,
        channelId: input.channelId,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      enabled: input.enabled,
      autoApproveBelowWords: input.autoApproveBelowWords,
      autoPublishAfterMinutes: input.autoPublishAfterMinutes,
      weeklyCeiling: input.weeklyCeiling,
      enabledByUserId: input.userId,
    },
    update: {
      enabled: input.enabled,
      autoApproveBelowWords: input.autoApproveBelowWords,
      autoPublishAfterMinutes: input.autoPublishAfterMinutes,
      weeklyCeiling: input.weeklyCeiling,
      enabledByUserId: input.userId,
      enabledAt: new Date(),
    },
    select: { policyId: true },
  });
  return { ok: true, policyId: row.policyId };
}

function countWords(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}
