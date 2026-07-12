import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: { agent: { findFirst: vi.fn() } },
}));
vi.mock("@dpf/db", () => db);

const marketplace = vi.hoisted(() => ({ getToolMarketplaceReadiness: vi.fn() }));
vi.mock("@/lib/actions/tool-marketplace-readiness", () => marketplace);

const assessmentService = vi.hoisted(() => ({
  submitCoworkerSelfAssessment: vi.fn(),
  listCoworkerCapabilityNeeds: vi.fn(),
}));
vi.mock("@/lib/coworker-self-assessment/assessment-service", () => assessmentService);

const reviewService = vi.hoisted(() => ({ getCoworkerCapabilityNeedReview: vi.fn() }));
vi.mock("@/lib/coworker-self-assessment/review-service", () => reviewService);

import { coworkerCapabilityPack } from "./coworker-capability-pack";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "get_my_coworker_profile",
  "assess_my_capabilities",
  "submit_coworker_capability_need",
  "list_my_capability_needs",
  "list_all_capability_needs",
];

const AGENT_ROW = {
  agentId: "agent-1",
  slugId: "agent-1",
  name: "Marketing Coworker",
  tier: 2,
  type: "specialist",
  description: "Runs marketing",
  valueStream: "marketing",
  it4itSections: [],
  lifecycleStage: "production",
  hitlTierDefault: 2,
  humanSupervisorId: null,
  escalatesTo: null,
  delegatesTo: [],
  toolGrants: [{ grantKey: "registry_read" }],
  skills: [{ label: "Draft", description: "d", capability: null, taskType: "conversation", sortOrder: 0 }],
  coworkerAssessments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coworker-capability pack — registration", () => {
  it("exposes exactly the five capability tools", () => {
    expect(coworkerCapabilityPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(coworkerCapabilityPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of coworkerCapabilityPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability/executionMode/sideEffect metadata verbatim", () => {
    const byName = Object.fromEntries(coworkerCapabilityPack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe("view_platform");
      expect(byName[t].executionMode, t).toBe("immediate");
    }
    expect(byName.get_my_coworker_profile.sideEffect).toBe(false);
    expect(byName.assess_my_capabilities.sideEffect).toBe(false);
    expect(byName.submit_coworker_capability_need.sideEffect).toBe(true);
    expect(byName.list_my_capability_needs.sideEffect).toBe(false);
    expect(byName.list_all_capability_needs.sideEffect).toBe(false);
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(coworkerCapabilityPack.grants[t]).toEqual(["registry_read"]);
      expect(TOOL_TO_GRANTS[t], t).toEqual(coworkerCapabilityPack.grants[t]);
      expect(isToolAllowedByGrants(t, ["registry_read"])).toBe(true);
    }
  });
});

describe("coworker-capability pack — handler behavior", () => {
  it("get_my_coworker_profile loads the current coworker's profile", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    const res = await coworkerCapabilityPack.handlers.get_my_coworker_profile({}, "u1", {
      agentId: "agent-1",
      routeContext: "/x",
    });
    expect(res.success).toBe(true);
    expect(res.message).toBe("Loaded coworker profile for Marketing Coworker.");
    expect((res.data as { profile: { name: string } }).profile.name).toBe("Marketing Coworker");
  });

  it("get_my_coworker_profile requires a current coworker agentId", async () => {
    await expect(
      coworkerCapabilityPack.handlers.get_my_coworker_profile({}, "u1", {}),
    ).rejects.toThrow(/current coworker agentId is required/);
  });

  it("assess_my_capabilities attaches readiness and the response shape", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    marketplace.getToolMarketplaceReadiness.mockResolvedValue({ summary: {}, entries: [] });
    const res = await coworkerCapabilityPack.handlers.assess_my_capabilities(
      { query: "marketing" },
      "u1",
      { agentId: "agent-1" },
    );
    expect(res.success).toBe(true);
    expect(marketplace.getToolMarketplaceReadiness).toHaveBeenCalledWith({
      query: "marketing",
      agentId: "agent-1",
      limit: 12,
    });
    const data = res.data as { readiness: unknown; responseShape: { verdict: string[] } };
    expect(data.readiness).toEqual({ summary: {}, entries: [] });
    expect(data.responseShape.verdict).toContain("gaps");
  });

  it("submit_coworker_capability_need rejects when no valid needs are supplied", async () => {
    const res = await coworkerCapabilityPack.handlers.submit_coworker_capability_need(
      { verdict: "gaps", confidence: "high", needs: [] },
      "u1",
      { agentId: "agent-1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("No valid capability needs supplied");
    expect(assessmentService.submitCoworkerSelfAssessment).not.toHaveBeenCalled();
  });

  it("submit_coworker_capability_need coerces verdict/confidence and reports counts", async () => {
    assessmentService.submitCoworkerSelfAssessment.mockResolvedValue({
      assessmentId: "assess-1",
      needIds: ["n1", "n2"],
      backlogItemIds: ["b1"],
    });
    const res = await coworkerCapabilityPack.handlers.submit_coworker_capability_need(
      {
        verdict: "not-a-verdict",
        confidence: "not-a-confidence",
        needs: [{ kind: "tool", severity: "blocker", need: "web fetch", blocks: "research" }],
      },
      "u1",
      { agentId: "agent-1", routeContext: "/y" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("assess-1");
    expect(res.message).toBe("Submitted 2 capability needs and filed 1 to the backlog for triage.");
    const call = assessmentService.submitCoworkerSelfAssessment.mock.calls[0][0];
    expect(call.agentId).toBe("agent-1");
    expect(call.trigger).toBe("tool-call");
    expect(call.verdict).toBe("gaps"); // invalid coerced to default
    expect(call.confidence).toBe("medium"); // invalid coerced to default
    expect(call.rawPayload).toEqual({ toolName: "submit_coworker_capability_need" });
    expect(call.needs).toHaveLength(1);
  });

  it("list_my_capability_needs forwards filters and reports the count", async () => {
    assessmentService.listCoworkerCapabilityNeeds.mockResolvedValue([{ id: "n1" }]);
    const res = await coworkerCapabilityPack.handlers.list_my_capability_needs(
      { status: "not-a-status", kind: "tool", severity: "blocker" },
      "u1",
      { agentId: "agent-1" },
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("Found 1 capability need.");
    expect(assessmentService.listCoworkerCapabilityNeeds).toHaveBeenCalledWith({
      agentId: "agent-1",
      status: undefined, // invalid dropped
      kind: "tool",
      severity: "blocker",
    });
  });

  it("list_all_capability_needs returns the governance rollup shape", async () => {
    reviewService.getCoworkerCapabilityNeedReview.mockResolvedValue({
      summary: { total: 3 },
      filterOptions: { statuses: [] },
      needs: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
    });
    const res = await coworkerCapabilityPack.handlers.list_all_capability_needs(
      { agentId: "agent-1" },
      "u1",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("Found 3 capability needs across all coworkers.");
    const data = res.data as { summary: { total: number }; needs: unknown[] };
    expect(data.summary.total).toBe(3);
    expect(data.needs).toHaveLength(3);
    expect(reviewService.getCoworkerCapabilityNeedReview).toHaveBeenCalledWith({
      agentId: "agent-1",
      status: undefined,
      kind: undefined,
      severity: undefined,
    });
  });
});
