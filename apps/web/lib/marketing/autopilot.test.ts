import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    outboundPublication: { count: vi.fn() },
    outboundDraft: { findUnique: vi.fn(), update: vi.fn() },
    outboundApprovalDecision: { create: vi.fn() },
    outboundAutopilotPolicy: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({
      outboundApprovalDecision: { create: vi.fn().mockResolvedValue({ decisionId: "dec-1" }) },
      outboundDraft: { update: vi.fn() },
    })),
  },
}));

import { prisma } from "@dpf/db";
import {
  isAutopilotEligible,
  setAutopilotPolicy,
  type AutopilotPolicy,
  type DraftLike,
} from "./autopilot";

beforeEach(() => vi.clearAllMocks());

function policy(overrides: Partial<AutopilotPolicy> = {}): AutopilotPolicy {
  return {
    policyId: "pol-1",
    organizationId: "org-1",
    channelId: "linkedin-personal-social",
    enabled: true,
    autoApproveBelowWords: 250,
    autoPublishAfterMinutes: 0,
    weeklyCeiling: 5,
    enabledByUserId: "user-1",
    ...overrides,
  };
}

function draft(overrides: Partial<DraftLike> = {}): DraftLike {
  return {
    draftId: "drf-1",
    organizationId: "org-1",
    channelId: "linkedin-personal-social",
    sourceType: "marketing-asset-task",
    status: "pending-review",
    body: "Short concise post body.",
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("isAutopilotEligible", () => {
  beforeEach(() => {
    vi.mocked(prisma.outboundPublication.count).mockResolvedValue(0 as never);
  });

  it("approves a normal LinkedIn personal draft below threshold", async () => {
    const result = await isAutopilotEligible(draft(), policy());
    expect(result.ok).toBe(true);
  });

  it("refuses when policy is disabled", async () => {
    const result = await isAutopilotEligible(draft(), policy({ enabled: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("policy_disabled");
  });

  it("HARD-REFUSES the ad channel even if a policy row exists", async () => {
    const result = await isAutopilotEligible(
      draft({ channelId: "linkedin-ads" }),
      policy({ channelId: "linkedin-ads" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/channel_not_in_autopilot_allowlist/);
  });

  it("HARD-REFUSES inbound-reply drafts", async () => {
    const result = await isAutopilotEligible(
      draft({ sourceType: "inbound-channel-message" }),
      policy(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("inbound_replies_never_autopiloted");
  });

  it("refuses drafts at or above the word threshold", async () => {
    const longBody = "word ".repeat(300);
    const result = await isAutopilotEligible(draft({ body: longBody }), policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/word_count.*above_threshold/);
  });

  it("refuses drafts with a [low confidence] marker", async () => {
    const result = await isAutopilotEligible(
      draft({ body: "Concept post [low confidence] needs review." }),
      policy(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("draft_contains_confidence_flag");
  });

  it("refuses when weekly ceiling reached", async () => {
    vi.mocked(prisma.outboundPublication.count).mockResolvedValue(5 as never);
    const result = await isAutopilotEligible(draft(), policy({ weeklyCeiling: 5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/weekly_ceiling_reached/);
  });

  it("refuses drafts not yet aged past autoPublishAfterMinutes", async () => {
    const fresh = new Date(Date.now() - 30 * 1000); // 30s ago
    const result = await isAutopilotEligible(
      draft({ updatedAt: fresh }),
      policy({ autoPublishAfterMinutes: 60 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/draft_not_aged/);
  });

  it("refuses drafts not in pending-review status", async () => {
    const result = await isAutopilotEligible(draft({ status: "approved" }), policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/draft_not_pending_review/);
  });
});

describe("setAutopilotPolicy", () => {
  it("rejects ad channel id outright", async () => {
    const result = await setAutopilotPolicy({
      organizationId: "org-1",
      channelId: "linkedin-ads",
      enabled: true,
      autoApproveBelowWords: null,
      autoPublishAfterMinutes: null,
      weeklyCeiling: 10,
      userId: "user-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not_autopilot_eligible/);
  });

  it("rejects negative weeklyCeiling", async () => {
    const result = await setAutopilotPolicy({
      organizationId: "org-1",
      channelId: "linkedin-personal-social",
      enabled: true,
      autoApproveBelowWords: null,
      autoPublishAfterMinutes: null,
      weeklyCeiling: -1,
      userId: "user-1",
    });
    expect(result.ok).toBe(false);
  });

  it("upserts when allowed", async () => {
    vi.mocked(prisma.outboundAutopilotPolicy.upsert).mockResolvedValue({ policyId: "pol-x" } as never);
    const result = await setAutopilotPolicy({
      organizationId: "org-1",
      channelId: "linkedin-personal-social",
      enabled: true,
      autoApproveBelowWords: 200,
      autoPublishAfterMinutes: 1440,
      weeklyCeiling: 3,
      userId: "user-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policyId).toBe("pol-x");
  });
});
