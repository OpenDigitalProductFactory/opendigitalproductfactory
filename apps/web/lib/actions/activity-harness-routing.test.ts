import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentActionProposal: {
      create: vi.fn(),
    },
    userFact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { confirmActivityHarnessOverrideAction } from "./activity-harness-routing";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY,
  loadApprovedActivityHarnessOverrides,
} from "@/lib/routing/activity-harness-approval-source";
import { revalidatePath } from "next/cache";

const INPUT = {
  proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
  activityClass: "plan",
  harnessRecipeKey: "edge.plan.balanced",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  confidence: "trusted" as const,
  summary: "Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
};

// PR-B named delta (BI-7BCC87BB; spec D2 S3): the two-step flow (queue a
// proposal under a synthetic agent, approve it in Needs-you) becomes the
// operator's own confirm. The tool runs through the monitor as the signed-in
// person (no agent, source rest), and the override is kept as a UserFact.
describe("confirmActivityHarnessOverrideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: false } } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "Activity routing confidence override approved." });
    vi.mocked(prisma.userFact.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userFact.create).mockResolvedValue({} as never);
    vi.mocked(prisma.userFact.updateMany).mockResolvedValue({ count: 0 } as never);
  });

  it("runs the override tool as the person, through the monitor, with no agent", async () => {
    await confirmActivityHarnessOverrideAction(INPUT);
    expect(governedExecuteTool).toHaveBeenCalledWith({
      toolName: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
      rawParams: {
        kind: "activity-harness-confidence-override",
        proposalId: INPUT.proposalId,
        activityClass: "plan",
        harnessRecipeKey: "edge.plan.balanced",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        confidence: "trusted",
      },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: "HR-000", isSuperuser: false },
      context: { routeContext: "/platform/ai/operations-map" },
      source: "rest",
    });
  });

  it("keeps the confirmed override as a current fact, superseding anyone else's for the same activity and recipe", async () => {
    const result = await confirmActivityHarnessOverrideAction(INPUT);
    expect(result).toEqual({ success: true, overrideId: INPUT.proposalId });
    expect(prisma.userFact.updateMany).toHaveBeenCalledWith({
      where: {
        category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY,
        key: "plan|edge.plan.balanced",
        supersededAt: null,
        NOT: { userId: "user-1" },
      },
      data: { supersededAt: expect.any(Date) },
    });
    const write = vi.mocked(prisma.userFact.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(write.data).toMatchObject({
      userId: "user-1",
      category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY,
      key: "plan|edge.plan.balanced",
      confidence: 1,
      sourceRoute: "/platform/ai/operations-map",
    });
    expect(JSON.parse(write.data.value as string)).toEqual({
      proposalId: INPUT.proposalId, activityClass: "plan", harnessRecipeKey: "edge.plan.balanced",
      providerId: "anthropic", modelId: "claude-sonnet", confidence: "trusted", approvedAt: expect.any(String),
    });
    expect(prisma.agentActionProposal.create).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/operations-map");
  });

  it("updates the person's own current fact instead of adding a second", async () => {
    vi.mocked(prisma.userFact.findFirst).mockResolvedValue({ id: "fact-1" } as never);
    await confirmActivityHarnessOverrideAction(INPUT);
    expect(prisma.userFact.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "fact-1" } }));
    expect(prisma.userFact.create).not.toHaveBeenCalled();
  });

  it("stores nothing when the monitor refuses, and says why", async () => {
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: false, error: "forbidden_capability", message: "You need view_platform." });
    const result = await confirmActivityHarnessOverrideAction(INPUT);
    expect(result).toEqual({ success: false, error: "You need view_platform." });
    expect(prisma.userFact.create).not.toHaveBeenCalled();
    expect(prisma.userFact.updateMany).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await confirmActivityHarnessOverrideAction(INPUT)).toEqual({ success: false, error: "Unauthorized" });
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it("the confirmed fact is read back as a live override, and an override approved before the change still applies", async () => {
    const value = JSON.stringify({ proposalId: INPUT.proposalId, activityClass: "plan", harnessRecipeKey: "edge.plan.balanced", providerId: "anthropic", modelId: "claude-sonnet", confidence: "trusted", approvedAt: "2026-10-07T00:00:00.000Z" });
    const overrides = await loadApprovedActivityHarnessOverrides({
      userFact: { findMany: async () => [{ userId: "user-1", key: "plan|edge.plan.balanced", value, createdAt: new Date("2026-10-07T00:00:00.000Z") }] },
      agentActionProposal: { findMany: async () => [{
        proposalId: "legacy-1", actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION, status: "executed",
        decidedById: "user-2", decidedAt: new Date("2026-09-01T00:00:00.000Z"),
        parameters: { proposalId: "legacy-1", activityClass: "build", harnessRecipeKey: "k", providerId: "p", modelId: null, confidence: "calibrating" },
      }] },
    }, { take: 10 });
    expect(overrides.map((override) => [override.proposalId, override.confidence, override.approvedBy])).toEqual([
      [INPUT.proposalId, "trusted", "user-1"],
      ["legacy-1", "calibrating", "user-2"],
    ]);
  });
});

// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S3.
// The tool's handler only acknowledges, and legacy proposal rows stay readable
// as overrides with the statuses below (spec D8 dual read).
describe("S3 — the override tool and the legacy rows (characterisation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the approved tool declares authority consequence and its handler only acknowledges", async () => {
    const { activityRoutingPack } = await import("@/lib/mcp/packs/activity-routing-pack");
    const definition = activityRoutingPack.definitions.find((d) => d.name === ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION);
    expect(definition).toMatchObject({ requiredCapability: "view_platform", executionMode: "immediate", sideEffect: true, consequence: "authority" });
    const handler = activityRoutingPack.handlers[ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION]!;
    const result = await handler(
      { kind: "activity-harness-confidence-override", activityClass: "plan", harnessRecipeKey: "k", providerId: "p", modelId: null, confidence: "trusted" },
      "user-1",
      {},
    );
    expect(result).toEqual({
      success: true,
      message: "Activity routing confidence override approved.",
      data: { kind: "activity-harness-confidence-override", activityClass: "plan", harnessRecipeKey: "k", providerId: "p", modelId: null, confidence: "trusted" },
    });
  });

  it("readers treat approve | approved | executed rows as live overrides, nothing else", async () => {
    const { activityHarnessOverridesFromProposalRows } = await import("@/lib/routing/activity-harness-approval-source");
    const row = (status: string) => ({
      proposalId: `p-${status}`, actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION, status,
      decidedById: "user-1", decidedAt: new Date("2026-10-01T00:00:00.000Z"),
      parameters: { proposalId: `p-${status}`, activityClass: "plan", harnessRecipeKey: "k", providerId: "p", modelId: null, confidence: "trusted" },
    });
    const live = activityHarnessOverridesFromProposalRows(
      ["approve", "approved", "executed", "proposed", "rejected", "failed"].map(row),
    ).map((override) => override.proposalId);
    expect(live).toEqual(["p-approve", "p-approved", "p-executed"]);
  });
});
