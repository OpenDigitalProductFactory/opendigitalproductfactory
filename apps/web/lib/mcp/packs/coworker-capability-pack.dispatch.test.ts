import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
  agent: {
    findFirst: vi.fn(),
  },
  },
}));

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage",
  prisma: mockPrisma,
}));

vi.mock("@/lib/actions/tool-marketplace-readiness", () => ({
  getToolMarketplaceReadiness: vi.fn().mockResolvedValue({
    summary: { total: 1, ready: 0, available: 0, needsSetup: 0, needsGrant: 1, blocked: 0 },
    entries: [
      {
        id: "marketing-publisher",
        kind: "built_in",
        name: "Marketing publisher",
        readiness: "needs_grant",
      },
    ],
  }),
}));

vi.mock("@/lib/coworker-self-assessment/assessment-service", () => ({
  listCoworkerCapabilityNeeds: vi.fn().mockResolvedValue([
    { needId: "CWN-000001", status: "submitted", kind: "tool" },
  ]),
  submitCoworkerSelfAssessment: vi.fn().mockResolvedValue({
    assessmentId: "CWSA-000001",
    needIds: ["CWN-000001"],
    backlogItemIds: ["BI-CWN-000001"],
  }),
}));

vi.mock("@/lib/coworker-self-assessment/review-service", () => ({
  // Severities mirror the canonical COWORKER_CAPABILITY_NEED_SEVERITIES enum
  // ("blocker" | "important" | "minor") from
  // apps/web/lib/coworker-self-assessment/types.ts — anything else would be
  // filtered out by the validator in mcp-tools.ts.
  getCoworkerCapabilityNeedReview: vi.fn().mockResolvedValue({
    summary: {
      total: 2,
      byStatus: { submitted: 2 },
      bySeverity: { blocker: 1, important: 1 },
      byKind: { tool: 1, skill: 1 },
    },
    filterOptions: {
      statuses: ["submitted", "reviewing"],
      severities: ["blocker", "important", "minor"],
      kinds: ["tool", "skill"],
    },
    needs: [
      {
        needId: "CWN-000001",
        agentId: "AGT-WS-MARKETING",
        status: "submitted",
        kind: "tool",
        severity: "blocker",
      },
      {
        needId: "CWN-000002",
        agentId: "AGT-WS-FINANCE",
        status: "submitted",
        kind: "skill",
        severity: "important",
      },
    ],
  }),
}));

import { getToolMarketplaceReadiness } from "@/lib/actions/tool-marketplace-readiness";
import {
  listCoworkerCapabilityNeeds,
  submitCoworkerSelfAssessment,
} from "@/lib/coworker-self-assessment/assessment-service";
import { getCoworkerCapabilityNeedReview } from "@/lib/coworker-self-assessment/review-service";
import { executeTool, getAvailableTools, PLATFORM_TOOLS } from "@/lib/mcp-tools";

describe("coworker self-assessment tools", () => {
  const platformUser = {
    userId: "user-1",
    platformRole: "HR-000",
    isSuperuser: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agent.findFirst.mockResolvedValue({
      agentId: "AGT-WS-MARKETING",
      slugId: "marketing-specialist",
      name: "marketing-specialist",
      tier: 2,
      type: "specialist",
      description: "Marketing strategy and work products.",
      valueStream: "release",
      it4itSections: ["Release"],
      lifecycleStage: "production",
      hitlTierDefault: 3,
      humanSupervisorId: "HR-500",
      escalatesTo: "AGT-ORCH-500",
      delegatesTo: [],
      skills: [
        {
          label: "Marketing strategy",
          description: "Plan proof content and campaigns.",
          capability: "marketing_read",
          taskType: "conversation",
          sortOrder: 0,
        },
      ],
      toolGrants: [
        { grantKey: "registry_read" },
        { grantKey: "marketing_read" },
        { grantKey: "marketing_write" },
      ],
      coworkerAssessments: [
        {
          assessmentId: "CWSA-OLD",
          verdict: "gaps",
          confidence: "medium",
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ],
    });
  });

  it("exposes profile, assessment, submit, and list tools to registry-readable coworkers", async () => {
    const tools = await getAvailableTools(platformUser, {
      agentId: "AGT-WS-MARKETING",
      mode: "act",
      externalAccessEnabled: false,
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      "get_my_coworker_profile",
      "assess_my_capabilities",
      "submit_coworker_capability_need",
      "list_my_capability_needs",
    ]));
  });

  it("returns current coworker profile and readiness context", async () => {
    const result = await executeTool(
      "get_my_coworker_profile",
      {},
      "user-1",
      { agentId: "AGT-WS-MARKETING", routeContext: "/customer/marketing" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ agentId: "AGT-WS-MARKETING" }, { slugId: "AGT-WS-MARKETING" }] },
    }));
    expect(result.data).toMatchObject({
      profile: {
        agentId: "AGT-WS-MARKETING",
        name: "marketing-specialist",
        routeContext: "/customer/marketing",
        grants: ["registry_read", "marketing_read", "marketing_write"],
      },
      latestAssessment: {
        assessmentId: "CWSA-OLD",
        verdict: "gaps",
      },
    });
  });

  it("builds assessment context from profile and marketplace readiness", async () => {
    const result = await executeTool(
      "assess_my_capabilities",
      { query: "marketing publishing" },
      "user-1",
      { agentId: "AGT-WS-MARKETING" },
    );

    expect(getToolMarketplaceReadiness).toHaveBeenCalledWith({
      query: "marketing publishing",
      agentId: "AGT-WS-MARKETING",
      limit: 12,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      profile: { agentId: "AGT-WS-MARKETING" },
      readiness: { summary: { needsGrant: 1 } },
      responseShape: expect.any(Object),
    });
  });

  it("loads assessment context for route-defined coworkers not yet present in Agent rows", async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce(null);

    const result = await executeTool(
      "assess_my_capabilities",
      { query: "current month finance totals" },
      "user-1",
      { agentId: "finance-agent", routeContext: "/finance" },
    );

    expect(result.success).toBe(true);
    expect(getToolMarketplaceReadiness).toHaveBeenCalledWith({
      query: "current month finance totals",
      agentId: "finance-agent",
      limit: 12,
    });
    expect(result.data).toMatchObject({
      profile: {
        agentId: "finance-agent",
        slugId: "finance-agent",
        name: "Finance Specialist",
        routeContext: "/finance",
        grants: expect.arrayContaining(["registry_read", "web_search"]),
        skills: expect.arrayContaining([
          expect.objectContaining({
            label: "Review finance posture",
            capability: "view_finance",
            taskType: "conversation",
          }),
        ]),
      },
      latestAssessment: null,
      responseShape: expect.any(Object),
    });
  });

  it("submits a capability need using the execution agent identity", async () => {
    const result = await executeTool(
      "submit_coworker_capability_need",
      {
        verdict: "gaps",
        confidence: "medium",
        missionSummary: "Create trustworthy proof content.",
        capabilitySummary: "Can advise, needs durable publishing workflow.",
        needs: [
          {
            kind: "tool",
            severity: "important",
            need: "Create proof assets as durable work products.",
            blocks: "Recommendations stay in chat.",
          },
        ],
      },
      "user-1",
      { agentId: "AGT-WS-MARKETING", routeContext: "/customer/marketing" },
    );

    expect(submitCoworkerSelfAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "AGT-WS-MARKETING",
        routeContext: "/customer/marketing",
        trigger: "tool-call",
      }),
    );
    expect(result).toMatchObject({
      success: true,
      entityId: "CWSA-000001",
      data: { assessmentId: "CWSA-000001", needIds: ["CWN-000001"] },
    });
  });

  it.each(["prompt", "convention", "code", "other"] as const)(
    "accepts %s as a capability-need kind through the MCP tool",
    async (kind) => {
      const result = await executeTool(
        "submit_coworker_capability_need",
        {
          verdict: "gaps",
          confidence: "medium",
          missionSummary: "Mission.",
          capabilitySummary: "Capability.",
          needs: [
            {
              kind,
              severity: "important",
              need: `Need a ${kind} improvement.`,
              blocks: "Blocked otherwise.",
            },
          ],
        },
        "user-1",
        { agentId: "AGT-WS-MARKETING", routeContext: "/customer/marketing" },
      );

      expect(result.success).toBe(true);
      expect(submitCoworkerSelfAssessment).toHaveBeenCalledWith(
        expect.objectContaining({
          needs: [expect.objectContaining({ kind })],
        }),
      );
    },
  );

  it("rejects an unknown capability-need kind through the MCP tool", async () => {
    const result = await executeTool(
      "submit_coworker_capability_need",
      {
        verdict: "gaps",
        confidence: "medium",
        missionSummary: "Mission.",
        capabilitySummary: "Capability.",
        needs: [
          {
            kind: "made-up",
            severity: "important",
            need: "Should reject.",
            blocks: "Blocked.",
          },
        ],
      },
      "user-1",
      { agentId: "AGT-WS-MARKETING", routeContext: "/customer/marketing" },
    );

    expect(result.success).toBe(false);
  });

  it("lists needs for the execution agent identity", async () => {
    const result = await executeTool(
      "list_my_capability_needs",
      { status: "submitted" },
      "user-1",
      { agentId: "AGT-WS-MARKETING" },
    );

    expect(listCoworkerCapabilityNeeds).toHaveBeenCalledWith({
      agentId: "AGT-WS-MARKETING",
      status: "submitted",
      kind: undefined,
      severity: undefined,
    });
    expect(result.data).toEqual({
      needs: [{ needId: "CWN-000001", status: "submitted", kind: "tool" }],
    });
  });
});

describe("list_all_capability_needs (BI-F9E7B780)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered in PLATFORM_TOOLS with read-only governance shape", () => {
    const tool = PLATFORM_TOOLS.find(
      (t) => t.name === "list_all_capability_needs",
    );
    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("view_platform");
    expect(tool?.sideEffect).toBe(false);
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    // ToolDefinition.inputSchema is typed as Record<string, unknown>, so the
    // nested `properties` and `required` keys need a narrow cast before
    // indexing. We treat the shape locally as a minimal JSON-Schema-ish
    // object — same approach the runtime code takes elsewhere.
    const schema = tool?.inputSchema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    expect(schema?.properties?.agentId).toBeDefined();
    expect(schema?.required ?? []).toEqual([]);
  });

  it("returns the all-coworker rollup with no filters (no agentId scoping)", async () => {
    const result = await executeTool(
      "list_all_capability_needs",
      {},
      "user-1",
    );

    expect(getCoworkerCapabilityNeedReview).toHaveBeenCalledWith({
      agentId: undefined,
      status: undefined,
      kind: undefined,
      severity: undefined,
    });
    expect(result.success).toBe(true);
    expect(result.data?.summary).toEqual({
      total: 2,
      byStatus: { submitted: 2 },
      bySeverity: { blocker: 1, important: 1 },
      byKind: { tool: 1, skill: 1 },
    });
    expect(result.data?.needs).toHaveLength(2);
    expect(result.message).toContain("2 capability needs across all coworkers");
  });

  it("passes filters through to the review-service helper", async () => {
    await executeTool(
      "list_all_capability_needs",
      {
        agentId: "AGT-WS-FINANCE",
        status: "submitted",
        kind: "skill",
        severity: "important",
      },
      "user-1",
    );

    expect(getCoworkerCapabilityNeedReview).toHaveBeenCalledWith({
      agentId: "AGT-WS-FINANCE",
      status: "submitted",
      kind: "skill",
      severity: "important",
    });
  });

  it("drops unknown enum values silently (mirrors list_my_capability_needs)", async () => {
    await executeTool(
      "list_all_capability_needs",
      {
        status: "not-a-real-status",
        kind: "garbage",
        severity: "extremely-spicy",
      },
      "user-1",
    );

    expect(getCoworkerCapabilityNeedReview).toHaveBeenCalledWith({
      agentId: undefined,
      status: undefined,
      kind: undefined,
      severity: undefined,
    });
  });

  it("uses the singular 'need' wording when total is 1", async () => {
    vi.mocked(getCoworkerCapabilityNeedReview).mockResolvedValueOnce({
      summary: { total: 1, byStatus: {}, bySeverity: {}, byKind: {} },
      filterOptions: { statuses: [], severities: [], kinds: [] },
      needs: [],
    });

    const result = await executeTool(
      "list_all_capability_needs",
      {},
      "user-1",
    );

    expect(result.message).toContain("1 capability need across");
    expect(result.message).not.toContain("needs across");
  });

  it("does NOT require a coworker context (the all-coworker variant is governance-scoped, not agent-scoped)", async () => {
    // Note: no agentId in context — should not call requireCurrentCoworker.
    const result = await executeTool(
      "list_all_capability_needs",
      {},
      "user-1",
      undefined,
    );
    expect(result.success).toBe(true);
  });
});
