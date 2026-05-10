import { describe, expect, it, vi } from "vitest";
import {
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
