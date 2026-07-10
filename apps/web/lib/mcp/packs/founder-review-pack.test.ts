import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  decisionInteractionFindMany: vi.fn(),
  organizationFindFirst: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    decisionInteraction: {
      findMany: (...args: unknown[]) => prismaMock.decisionInteractionFindMany(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => prismaMock.organizationFindFirst(...args),
    },
  },
}));

const resolveOrgProfileIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/decision-perspective/material", () => ({
  resolveOrgProfileId: (...args: unknown[]) => resolveOrgProfileIdMock(...args),
}));

import { founderReviewPack } from "./founder-review-pack";
import {
  isToolAllowedByGrants,
  COWORKER_READ_BASELINE_GRANTS,
} from "@/lib/tak/agent-grants";

function reviewRow(over: Record<string, unknown> = {}) {
  return {
    interactionId: "DI-1",
    question: "Should we prioritize the migration or the new feature?",
    options: [{ id: "migrate" }, { id: "feature" }],
    outcomeType: "escalate",
    outcomePayload: { unresolvedReason: "principle-gap" },
    buildId: null,
    taskRunId: null,
    routeContext: "/build",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    profile: { profileId: "mark-dpf-platform", name: "WWMD Platform", kind: "platform" },
    deferralCapture: null,
    escalationCapture: { prompt: "Needs a founder ruling on migration-vs-feature priority." },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationFindFirst.mockResolvedValue({ id: "org-1" });
  resolveOrgProfileIdMock.mockResolvedValue(null);
});

describe("founder-review pack — list_open_decision_reviews", () => {
  it("registers as a read-only coworker tool", () => {
    const def = founderReviewPack.definitions.find((d) => d.name === "list_open_decision_reviews");
    expect(def).toBeDefined();
    expect(def!.sideEffect).toBe(false);
    expect(founderReviewPack.handlers.list_open_decision_reviews).toBeTypeOf("function");
  });

  it("is reachable by every coworker via the registry_read baseline (mirrors TOOL_TO_GRANTS)", () => {
    expect(founderReviewPack.grants.list_open_decision_reviews).toEqual(["registry_read"]);
    // A coworker with only the read baseline can call it — this is what unblocks the COO.
    expect(isToolAllowedByGrants("list_open_decision_reviews", [...COWORKER_READ_BASELINE_GRANTS])).toBe(true);
    // But it is NOT reachable with an unrelated write-only grant set (default-deny holds).
    expect(isToolAllowedByGrants("list_open_decision_reviews", ["backlog_write"])).toBe(false);
  });

  it("returns the projected open-review queue with gap detail and a decision-canvas link", async () => {
    prismaMock.decisionInteractionFindMany.mockResolvedValue([reviewRow()]);

    const res = await founderReviewPack.handlers.list_open_decision_reviews!({}, "user-1");

    expect(res.success).toBe(true);
    expect(res.data?.count).toBe(1);
    const review = (res.data?.reviews as Array<Record<string, unknown>>)[0];
    expect(review.interactionId).toBe("DI-1");
    expect(review.question).toContain("prioritize the migration");
    expect(review.outcomeType).toBe("escalate");
    expect(review.gapDetail).toBe("Needs a founder ruling on migration-vs-feature priority.");
    expect(review.decisionCanvasHref).toBe("/platform/ai/decisions/DI-1");
    // deferralCapture.gapReason wins over escalationCapture.prompt when present.
    expect(review.suggestedAction).toBeTypeOf("string");
  });

  it("scopes to WSID via a profileId startsWith filter and clamps the limit to 50", async () => {
    prismaMock.decisionInteractionFindMany.mockResolvedValue([]);

    await founderReviewPack.handlers.list_open_decision_reviews!(
      { discipline: "wsid", limit: 999 },
      "user-1",
    );

    const args = prismaMock.decisionInteractionFindMany.mock.calls[0][0] as {
      where: { profileId?: unknown; outcomeType?: unknown };
      take: number;
    };
    expect(args.where.profileId).toEqual({ startsWith: "wsid-" });
    expect(args.where.outcomeType).toEqual({ in: ["defer", "escalate"] });
    expect(args.take).toBe(50);
  });

  it("prefers the deferral gapReason for a deferred review", async () => {
    prismaMock.decisionInteractionFindMany.mockResolvedValue([
      reviewRow({
        interactionId: "DI-2",
        outcomeType: "defer",
        deferralCapture: { gapReason: "No org stance recorded for refund policy.", domain: "policy", suggestedSourceTypes: ["stance"] },
        escalationCapture: null,
      }),
    ]);

    const res = await founderReviewPack.handlers.list_open_decision_reviews!({ discipline: "all" }, "user-1");
    const review = (res.data?.reviews as Array<Record<string, unknown>>)[0];
    expect(review.gapDetail).toBe("No org stance recorded for refund policy.");
    expect(review.suggestedSourceTypes).toEqual(["stance"]);
  });
});
