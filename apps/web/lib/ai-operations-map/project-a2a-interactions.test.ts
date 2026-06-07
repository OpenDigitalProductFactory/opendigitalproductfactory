import { describe, expect, it } from "vitest";
import {
  projectA2aInteractions,
  type A2aDelegationSourceRow,
  type A2aDeliberationSourceRow,
  type A2aPhaseHandoffSourceRow,
  type A2aTaskLineageSourceRow,
} from "./project-a2a-interactions";
import type { RoutingCoworkerSourceRow } from "./project-routing-topology";

const AGENTS: RoutingCoworkerSourceRow[] = [
  { agentId: "ceo-coworker", name: "CEO Coworker", stationLabel: "Direct" },
  { agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" },
  { agentId: "brand-analyst", name: "Brand Analyst", stationLabel: "Brand" },
  { agentId: "reviewer", name: "Reviewer", stationLabel: "Review" },
];

function emptyInput() {
  return {
    agents: AGENTS,
    delegationChains: [] as A2aDelegationSourceRow[],
    phaseHandoffs: [] as A2aPhaseHandoffSourceRow[],
    taskLineage: [] as A2aTaskLineageSourceRow[],
    deliberations: [] as A2aDeliberationSourceRow[],
  };
}

function makeDelegation(overrides: Partial<A2aDelegationSourceRow> = {}): A2aDelegationSourceRow {
  return {
    id: "del-1",
    chainId: "chain-1",
    depth: 0,
    fromAgentId: "ceo-coworker",
    toAgentId: "brand-analyst",
    skillId: "brand-extract",
    authorityScope: ["brand:read", "brand:write"],
    status: "active",
    reason: "Delegated brand extraction",
    startedAt: new Date("2026-06-04T10:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("A2A interaction projection", () => {
  it("returns an empty projection with the legend when there is no A2A activity", () => {
    const projection = projectA2aInteractions(emptyInput());
    expect(projection.a2aEdges).toEqual([]);
    expect(projection.coworkers).toEqual([]);
    expect(projection.legend.map((item) => item.edgeKind)).toEqual([
      "a2a-delegation",
      "a2a-handoff",
      "a2a-task-lineage",
      "a2a-deliberation",
    ]);
  });

  it("projects a delegation chain row into a coworker→coworker delegation edge", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      delegationChains: [makeDelegation()],
    });

    expect(projection.a2aEdges).toEqual([
      expect.objectContaining({
        edgeKind: "a2a-delegation",
        fromCoworkerId: "ceo-coworker",
        toCoworkerId: "brand-analyst",
        state: "active",
        skillId: "brand-extract",
        authorityScope: ["brand:read", "brand:write"],
        summary: "Delegated brand extraction",
        refs: expect.objectContaining({ delegationChainId: "del-1" }),
      }),
    ]);
    // Both endpoints become coworker nodes, even a pure target.
    expect(projection.coworkers.map((c) => c.agentId).sort()).toEqual(["brand-analyst", "ceo-coworker"]);
  });

  it("maps delegation status into interaction state", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      delegationChains: [
        makeDelegation({ id: "d-a", status: "completed" }),
        makeDelegation({ id: "d-b", status: "failed", toAgentId: "reviewer" }),
        makeDelegation({ id: "d-c", status: "blocked", toAgentId: "build-specialist" }),
      ],
    });
    expect(projection.a2aEdges.map((e) => e.state)).toEqual(["completed", "failed", "blocked"]);
  });

  it("drops self-edges and rows missing an agent on either end", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      delegationChains: [
        makeDelegation({ id: "self", fromAgentId: "ceo-coworker", toAgentId: "ceo-coworker" }),
        makeDelegation({ id: "no-from", fromAgentId: "", toAgentId: "reviewer" }),
        makeDelegation({ id: "no-to", fromAgentId: "ceo-coworker", toAgentId: "" }),
      ],
    });
    expect(projection.a2aEdges).toEqual([]);
  });

  it("projects a build phase handoff edge with gate result", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      phaseHandoffs: [
        {
          id: "ph-1",
          buildId: "FB-123",
          fromPhase: "plan",
          toPhase: "build",
          fromAgentId: "build-specialist",
          toAgentId: "reviewer",
          summary: "Plan approved, advancing to build.",
          gatePassed: true,
          gateLabel: "plan gate passed",
          tokenBudgetUsed: 4200,
          createdAt: new Date("2026-06-04T11:00:00.000Z"),
        },
      ],
    });

    expect(projection.a2aEdges).toEqual([
      expect.objectContaining({
        edgeKind: "a2a-handoff",
        fromCoworkerId: "build-specialist",
        toCoworkerId: "reviewer",
        state: "completed",
        buildId: "FB-123",
        gateResult: "plan gate passed",
        refs: expect.objectContaining({ phaseHandoffId: "ph-1" }),
      }),
    ]);
    expect(projection.a2aEdges[0]?.label).toContain("plan");
    expect(projection.a2aEdges[0]?.label).toContain("build");
  });

  it("marks a handoff with a failed gate as blocked", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      phaseHandoffs: [
        {
          id: "ph-2",
          buildId: "FB-9",
          fromPhase: "build",
          toPhase: "review",
          fromAgentId: "build-specialist",
          toAgentId: "reviewer",
          summary: "Gate did not pass.",
          gatePassed: false,
          gateLabel: "review gate failed",
          tokenBudgetUsed: 0,
          createdAt: new Date("2026-06-04T11:30:00.000Z"),
        },
      ],
    });
    expect(projection.a2aEdges[0]?.state).toBe("blocked");
  });

  it("projects task lineage when the acting agent differs from the initiator", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      taskLineage: [
        {
          id: "tr-1",
          taskRunId: "TR-1",
          initiatingAgentId: "ceo-coworker",
          currentAgentId: "build-specialist",
          parentTaskRunId: null,
          parentAgentId: null,
          title: "Ship landing page",
          objective: "Produce and ship the landing page",
          status: "working",
          buildId: null,
          startedAt: new Date("2026-06-04T12:00:00.000Z"),
        },
      ],
    });
    expect(projection.a2aEdges).toEqual([
      expect.objectContaining({
        edgeKind: "a2a-task-lineage",
        fromCoworkerId: "ceo-coworker",
        toCoworkerId: "build-specialist",
        state: "active",
        refs: expect.objectContaining({ taskRunId: "TR-1" }),
      }),
    ]);
  });

  it("uses the resolved parent agent for child task lineage and skips same-agent tasks", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      taskLineage: [
        {
          id: "tr-child",
          taskRunId: "TR-child",
          initiatingAgentId: "build-specialist",
          currentAgentId: "reviewer",
          parentTaskRunId: "TR-parent",
          parentAgentId: "ceo-coworker",
          title: "Review child task",
          objective: "Review the work",
          status: "completed",
          buildId: null,
          startedAt: new Date("2026-06-04T12:10:00.000Z"),
        },
        {
          id: "tr-same",
          taskRunId: "TR-same",
          initiatingAgentId: "reviewer",
          currentAgentId: "reviewer",
          parentTaskRunId: null,
          parentAgentId: null,
          title: "Self task",
          objective: "No handoff",
          status: "working",
          buildId: null,
          startedAt: new Date("2026-06-04T12:20:00.000Z"),
        },
      ],
    });
    expect(projection.a2aEdges).toHaveLength(1);
    expect(projection.a2aEdges[0]).toEqual(
      expect.objectContaining({
        edgeKind: "a2a-task-lineage",
        fromCoworkerId: "ceo-coworker",
        toCoworkerId: "reviewer",
        state: "completed",
      }),
    );
  });

  it("projects deliberation fan-out edges from coordinator to each branch persona", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      deliberations: [
        {
          id: "delib-1",
          coordinatorAgentId: "ceo-coworker",
          patternLabel: "Diversity review",
          consensusState: "consensus",
          taskRunId: "TR-7",
          startedAt: new Date("2026-06-04T13:00:00.000Z"),
          branches: [
            { nodeId: "n1", agentId: "build-specialist", workerRole: "reviewer", status: "completed" },
            { nodeId: "n2", agentId: "reviewer", workerRole: "skeptical_reviewer", status: "completed" },
            { nodeId: "n3", agentId: "build-specialist", workerRole: "reviewer", status: "completed" },
          ],
        },
      ],
    });

    const delibEdges = projection.a2aEdges.filter((e) => e.edgeKind === "a2a-deliberation");
    // De-duped per (coordinator, branch agent): build-specialist appears once, weight reflects 2 branches.
    expect(delibEdges.map((e) => e.toCoworkerId).sort()).toEqual(["build-specialist", "reviewer"]);
    delibEdges.forEach((edge) => {
      expect(edge.fromCoworkerId).toBe("ceo-coworker");
      expect(edge.refs.deliberationRunId).toBe("delib-1");
    });
    const buildEdge = delibEdges.find((e) => e.toCoworkerId === "build-specialist");
    expect(buildEdge?.weight).toBeGreaterThanOrEqual(2);
  });

  it("contributes timeline markers for each projected edge", () => {
    const projection = projectA2aInteractions({
      ...emptyInput(),
      delegationChains: [makeDelegation()],
    });
    expect(projection.timeline).toHaveLength(1);
    expect(projection.timeline[0]).toEqual(
      expect.objectContaining({ occurredAt: "2026-06-04T10:00:00.000Z" }),
    );
  });
});
