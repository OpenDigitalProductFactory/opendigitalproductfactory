import { describe, expect, it, vi } from "vitest";
import {
  capabilityNeedOriginId,
  capabilityNeedToWorkType,
  buildCapabilityNeedBacklogInput,
  fileCapabilityNeedToBacklog,
  linkNeedToBacklogItem,
  listCoworkerCapabilityNeeds,
  resolveCapabilityNeed,
  submitCoworkerSelfAssessment,
} from "./assessment-service";

const createdAt = new Date("2026-05-10T05:30:00.000Z");

function makeDeps() {
  return {
    now: () => createdAt,
    createId: vi
      .fn()
      .mockReturnValueOnce("CWSA-000001")
      .mockReturnValueOnce("CWN-000001")
      .mockReturnValueOnce("CWN-000002"),
    db: {
      createAssessment: vi.fn(async (data) => ({ ...data, id: "assessment-row-1" })),
      createNeed: vi.fn(async (data) => ({ ...data, id: `need-row-${data.needId}` })),
      listNeeds: vi.fn(async () => []),
      updateNeed: vi.fn(async (needId, data) => ({ needId, ...data })),
    },
    fileBacklogItem: vi.fn(
      async (n: { needId: string }): Promise<{ itemId: string } | null> => ({ itemId: `BI-${n.needId}` }),
    ),
  };
}

describe("submitCoworkerSelfAssessment", () => {
  it("persists an assessment and normalized needs with coworker attribution", async () => {
    const deps = makeDeps();

    const result = await submitCoworkerSelfAssessment(
      {
        agentId: "marketing-strategist",
        trigger: "user-request",
        routeContext: "/customer/marketing",
        verdict: "gaps",
        confidence: "medium",
        missionSummary: "Turn offers into trustworthy market-facing proof.",
        capabilitySummary: "Can advise and draft, but needs governed publishing tools.",
        rawPayload: { source: "conversation" },
        needs: [
          {
            kind: "tool",
            severity: "important",
            need: "Create publish-ready proof assets in the marketing workspace.",
            blocks: "The role cannot turn approved recommendations into durable assets.",
            evidenceJson: { asked: "do you have tools to do this?" },
            readinessJson: { matchingTools: [] },
          },
          {
            kind: "ui_surface",
            severity: "minor",
            need: "Show accepted marketing needs in the coworker panel.",
            blocks: "The role cannot see whether a submitted need is already planned.",
          },
        ],
      },
      deps,
    );

    expect(result.assessmentId).toBe("CWSA-000001");
    expect(result.needIds).toEqual(["CWN-000001", "CWN-000002"]);
    expect(deps.db.createAssessment).toHaveBeenCalledWith({
      assessmentId: "CWSA-000001",
      agentId: "marketing-strategist",
      trigger: "user-request",
      routeContext: "/customer/marketing",
      verdict: "gaps",
      confidence: "medium",
      missionSummary: "Turn offers into trustworthy market-facing proof.",
      capabilitySummary: "Can advise and draft, but needs governed publishing tools.",
      rawPayload: { source: "conversation" },
      createdAt,
    });
    expect(deps.db.createNeed).toHaveBeenNthCalledWith(1, {
      needId: "CWN-000001",
      assessmentId: "CWSA-000001",
      agentId: "marketing-strategist",
      kind: "tool",
      severity: "important",
      status: "submitted",
      need: "Create publish-ready proof assets in the marketing workspace.",
      blocks: "The role cannot turn approved recommendations into durable assets.",
      evidenceJson: { asked: "do you have tools to do this?" },
      readinessJson: { matchingTools: [] },
      createdAt,
    });
    expect(deps.db.createNeed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        needId: "CWN-000002",
        assessmentId: "CWSA-000001",
        agentId: "marketing-strategist",
        status: "submitted",
      }),
    );
  });

  it("auto-files each need to the backlog and links it back", async () => {
    const deps = makeDeps();

    const result = await submitCoworkerSelfAssessment(
      {
        agentId: "marketing-strategist",
        trigger: "tool-call",
        routeContext: "/customer/marketing",
        verdict: "gaps",
        confidence: "medium",
        rawPayload: {},
        needs: [
          {
            kind: "tool",
            severity: "important",
            need: "Create publish-ready proof assets.",
            blocks: "Cannot turn recommendations into assets.",
          },
        ],
      },
      deps,
    );

    // Filed through the front door with coworker + kind context.
    expect(deps.fileBacklogItem).toHaveBeenCalledWith(
      expect.objectContaining({ needId: "CWN-000001", agentId: "marketing-strategist", kind: "tool" }),
    );
    // Linked back + marked filed (no manual link step needed).
    expect(deps.db.updateNeed).toHaveBeenCalledWith("CWN-000001", {
      linkedBacklogItemId: "BI-CWN-000001",
      status: "backlog-filed",
    });
    expect(result.backlogItemIds).toEqual(["BI-CWN-000001"]);
  });

  it("records the need even when the backlog projection fails (non-fatal)", async () => {
    const deps = makeDeps();
    deps.fileBacklogItem.mockResolvedValueOnce(null);

    const result = await submitCoworkerSelfAssessment(
      {
        agentId: "ops-coordinator",
        trigger: "tool-call",
        routeContext: "/ops",
        verdict: "gaps",
        confidence: "low",
        rawPayload: {},
        needs: [{ kind: "skill", severity: "minor", need: "Need X.", blocks: "Blocks Y." }],
      },
      deps,
    );

    expect(deps.db.createNeed).toHaveBeenCalledOnce();
    expect(deps.db.updateNeed).not.toHaveBeenCalled(); // no link when filing failed
    expect(result.needIds).toEqual(["CWN-000001"]);
    expect(result.backlogItemIds).toEqual([]);
  });
});

describe("capabilityNeedToWorkType", () => {
  it("carries the precise kinds through", () => {
    expect(capabilityNeedToWorkType("tool")).toBe("tool");
    expect(capabilityNeedToWorkType("skill")).toBe("skill");
  });
  it("maps prompt/convention to doc and grant/model/boundary to chore", () => {
    expect(capabilityNeedToWorkType("prompt")).toBe("doc");
    expect(capabilityNeedToWorkType("convention")).toBe("doc");
    expect(capabilityNeedToWorkType("grant")).toBe("chore");
    expect(capabilityNeedToWorkType("model")).toBe("chore");
    expect(capabilityNeedToWorkType("boundary")).toBe("chore");
  });
  it("defaults the rest to feature", () => {
    expect(capabilityNeedToWorkType("data")).toBe("feature");
    expect(capabilityNeedToWorkType("ui_surface")).toBe("feature");
    expect(capabilityNeedToWorkType("other")).toBe("feature");
  });
});

describe("capabilityNeedOriginId", () => {
  it("is stable across whitespace/case so re-surfaced gaps dedup to one item", () => {
    const a = capabilityNeedOriginId("agent-1", "tool", "  Need   PUBLISH tools.  ");
    const b = capabilityNeedOriginId("agent-1", "tool", "need publish tools.");
    expect(a).toBe(b);
    expect(a).toBe("agent-1:tool:need publish tools.");
  });
});

describe("buildCapabilityNeedBacklogInput", () => {
  it("anchors AI coworker capability needs to the AI Workforce product and taxonomy", () => {
    const input = buildCapabilityNeedBacklogInput(
      {
        needId: "CWN-000001",
        agentId: "finance-controller",
        kind: "tool",
        severity: "important",
        need: "Read tax remittance configuration.",
        blocks: "Cannot prepare tax evidence without configuration access.",
      },
      { digitalProductId: "dp-ai-workforce", taxonomyNodeId: "tn-workforce" },
    );

    expect(input).toMatchObject({
      type: "product",
      digitalProductId: "dp-ai-workforce",
      taxonomyNodeId: "tn-workforce",
      agentId: "finance-controller",
      origin: { kind: "capability-need", id: "finance-controller:tool:read tax remittance configuration." },
    });
  });
});

describe("fileCapabilityNeedToBacklog", () => {
  it("resolves structural Workforce links before filing through backlog ingest", async () => {
    const ingest = vi.fn(async () => ({ itemId: "BI-CAP-000001", id: "cuid-bi", created: true }));

    await fileCapabilityNeedToBacklog(
      {
        needId: "CWN-000001",
        agentId: "finance-controller",
        kind: "tool",
        severity: "important",
        need: "Read tax remittance configuration.",
        blocks: "Cannot prepare tax evidence without configuration access.",
      },
      {
        resolveWorkforceLinks: async () => ({
          digitalProductId: "dp-ai-workforce",
          taxonomyNodeId: "tn-workforce",
        }),
        ingest,
      },
    );

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        digitalProductId: "dp-ai-workforce",
        taxonomyNodeId: "tn-workforce",
        type: "product",
      }),
    );
  });
});

describe("listCoworkerCapabilityNeeds", () => {
  it("passes review filters through to persistence", async () => {
    const deps = makeDeps();
    deps.db.listNeeds.mockResolvedValueOnce([
      { needId: "CWN-000001", agentId: "marketing-strategist", status: "submitted" },
    ] as never);

    const result = await listCoworkerCapabilityNeeds(
      { agentId: "marketing-strategist", status: "submitted", kind: "tool" },
      deps,
    );

    expect(deps.db.listNeeds).toHaveBeenCalledWith({
      agentId: "marketing-strategist",
      status: "submitted",
      kind: "tool",
    });
    expect(result).toEqual([
      { needId: "CWN-000001", agentId: "marketing-strategist", status: "submitted" },
    ]);
  });
});

describe("linkNeedToBacklogItem", () => {
  it("marks a need as backlog-filed and stores the linked backlog item", async () => {
    const deps = makeDeps();

    await linkNeedToBacklogItem("CWN-000001", "BI-56469E47", deps);

    expect(deps.db.updateNeed).toHaveBeenCalledWith("CWN-000001", {
      linkedBacklogItemId: "BI-56469E47",
      status: "backlog-filed",
    });
  });
});

describe("resolveCapabilityNeed", () => {
  it("records duplicate decisions with the canonical need", async () => {
    const deps = makeDeps();

    await resolveCapabilityNeed(
      "CWN-000002",
      { status: "duplicate", duplicateOfId: "CWN-000001", reviewerNote: "Same publishing gap." },
      deps,
    );

    expect(deps.db.updateNeed).toHaveBeenCalledWith("CWN-000002", {
      status: "duplicate",
      duplicateOfId: "CWN-000001",
      reviewerNote: "Same publishing gap.",
    });
  });
});
