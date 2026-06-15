// apps/web/lib/ai-operations-map/project-a2a-interactions.scenarios.test.ts
//
// P1 shape coverage for the multi-agent A2A verification thread. Where the
// sibling project-a2a-interactions.test.ts covers per-edge projection logic in
// isolation, this suite encodes the eight collaboration SHAPES from
// docs/superpowers/specs/2026-06-14-multi-agent-a2a-verification-scenarios-design.md
// as composite fixtures and asserts the ops-map A2A band projects each one
// correctly — the regression net for "do the multi-agent visuals hold across
// situations". Marketing (approval-gated cross-domain fan-out) is the centerpiece.
//
// Boundary note: S3 (escalation, from queue:escalation events) and S8 (multi-
// tenant isolation, enforced in the loader's org-scoped query) are NOT
// projector-level concerns — they are asserted in the conversational layer /
// loader respectively. This suite documents that boundary rather than faking it.

import { describe, expect, it } from "vitest";
import {
  projectA2aInteractions,
  type A2aDelegationSourceRow,
  type A2aDeliberationSourceRow,
  type A2aPhaseHandoffSourceRow,
  type A2aTaskLineageSourceRow,
} from "./project-a2a-interactions";
import type { RoutingCoworkerSourceRow } from "./project-routing-topology";

// A roster spanning the value streams the scenarios collaborate across.
const ROSTER: RoutingCoworkerSourceRow[] = [
  { agentId: "marketing-specialist", name: "Marketing Specialist", stationLabel: "Consume" },
  { agentId: "documentation-specialist", name: "Documentation Specialist", stationLabel: "Cross-cutting" },
  { agentId: "licensing-specialist", name: "Licensing Specialist", stationLabel: "Cross-cutting" },
  { agentId: "finance-agent", name: "Finance Agent", stationLabel: "Cross-cutting" },
  { agentId: "consume-orchestrator", name: "Consume Orchestrator", stationLabel: "Consume" },
  { agentId: "build-specialist", name: "Build Specialist", stationLabel: "Build" },
  { agentId: "build-da", name: "Data Architect", stationLabel: "Build" },
  { agentId: "build-se", name: "Software Engineer", stationLabel: "Build" },
  { agentId: "build-qa", name: "QA Engineer", stationLabel: "Build" },
  { agentId: "monitoring-agent", name: "Monitoring", stationLabel: "Operate" },
  { agentId: "incident-detection-agent", name: "Incident Detection", stationLabel: "Operate" },
  { agentId: "incident-resolution-agent", name: "Incident Resolution", stationLabel: "Operate" },
];

function input(over: Partial<Parameters<typeof projectA2aInteractions>[0]> = {}) {
  return {
    agents: ROSTER,
    delegationChains: [] as A2aDelegationSourceRow[],
    phaseHandoffs: [] as A2aPhaseHandoffSourceRow[],
    taskLineage: [] as A2aTaskLineageSourceRow[],
    deliberations: [] as A2aDeliberationSourceRow[],
    ...over,
  };
}

let seq = 0;
function at(): Date {
  // Deterministic monotonic timestamps (no Date.now()).
  return new Date(Date.UTC(2026, 5, 14, 9, seq++, 0));
}

function handoff(from: string, to: string, fromPhase: string, toPhase: string, gatePassed: boolean | null = true): A2aPhaseHandoffSourceRow {
  return {
    id: `ph-${from}-${to}-${seq}`,
    buildId: "FB-CAMPAIGN",
    fromPhase,
    toPhase,
    fromAgentId: from,
    toAgentId: to,
    summary: `${from} → ${to}`,
    gatePassed,
    gateLabel: gatePassed === false ? "gate blocked" : "gate passed",
    tokenBudgetUsed: 3000,
    createdAt: at(),
  };
}

function delegation(from: string, to: string, status = "active"): A2aDelegationSourceRow {
  return {
    id: `del-${from}-${to}-${seq}`,
    chainId: `chain-${from}`,
    depth: 1,
    fromAgentId: from,
    toAgentId: to,
    skillId: null,
    authorityScope: ["task:dispatch"],
    status,
    reason: `${from} delegated to ${to}`,
    startedAt: at(),
    completedAt: status === "completed" ? at() : null,
  };
}

function lineage(from: string, to: string, status: string): A2aTaskLineageSourceRow {
  return {
    id: `tr-${from}-${to}-${seq}`,
    taskRunId: `TR-${seq}`,
    initiatingAgentId: from,
    currentAgentId: to,
    parentTaskRunId: null,
    parentAgentId: null,
    title: `${from} → ${to}`,
    objective: null,
    status,
    buildId: null,
    startedAt: at(),
  };
}

describe("A2A shape coverage (P1)", () => {
  // ── S1 — Sequential chain (A→B→C) ──────────────────────────────────────
  it("S1: a sequential handoff chain projects ordered, chained edges", () => {
    const { a2aEdges } = projectA2aInteractions(
      input({
        phaseHandoffs: [
          handoff("monitoring-agent", "incident-detection-agent", "detect", "triage"),
          handoff("incident-detection-agent", "incident-resolution-agent", "triage", "resolve"),
        ],
      }),
    );
    expect(a2aEdges.map((e) => [e.fromCoworkerId, e.toCoworkerId])).toEqual([
      ["monitoring-agent", "incident-detection-agent"],
      ["incident-detection-agent", "incident-resolution-agent"],
    ]);
    // The chain links: each edge's target is the next edge's source.
    expect(a2aEdges[0].toCoworkerId).toBe(a2aEdges[1].fromCoworkerId);
  });

  // ── S2 — Fan-out dispatch (orchestrator → N specialists) ───────────────
  it("S2: a fan-out dispatch projects N delegation edges from one coordinator", () => {
    const { a2aEdges, coworkers } = projectA2aInteractions(
      input({
        delegationChains: [
          delegation("build-specialist", "build-da"),
          delegation("build-specialist", "build-se"),
          delegation("build-specialist", "build-qa"),
        ],
      }),
    );
    expect(a2aEdges).toHaveLength(3);
    expect(new Set(a2aEdges.map((e) => e.fromCoworkerId))).toEqual(new Set(["build-specialist"]));
    expect(a2aEdges.map((e) => e.toCoworkerId).sort()).toEqual(["build-da", "build-qa", "build-se"]);
    // The coordinator + 3 specialists are all coworker nodes (deduped).
    expect(coworkers.map((c) => c.agentId).sort()).toEqual(["build-da", "build-qa", "build-se", "build-specialist"]);
  });

  // ── Marketing centerpiece: S2 fan-out + S5 approval gate ───────────────
  it("Marketing: cross-domain fan-out to content/compliance/budget then a blocked approval gate", () => {
    const { a2aEdges } = projectA2aInteractions(
      input({
        // marketing-specialist pulls in content, compliance, and budget peers
        delegationChains: [
          delegation("marketing-specialist", "documentation-specialist"),
          delegation("marketing-specialist", "licensing-specialist"),
          delegation("marketing-specialist", "finance-agent"),
        ],
        // then hands the campaign to the orchestrator for approval — gate not passed
        phaseHandoffs: [
          handoff("marketing-specialist", "consume-orchestrator", "draft", "approval", /* gatePassed */ false),
        ],
      }),
    );
    const fanOut = a2aEdges.filter((e) => e.edgeKind === "a2a-delegation");
    expect(fanOut.map((e) => e.toCoworkerId).sort()).toEqual([
      "documentation-specialist",
      "finance-agent",
      "licensing-specialist",
    ]);
    const approval = a2aEdges.find((e) => e.edgeKind === "a2a-handoff");
    // S5: the waiting/denied approval renders as a blocked transition (not silently "completed").
    expect(approval?.state).toBe("blocked");
    expect(approval?.toCoworkerId).toBe("consume-orchestrator");
  });

  // ── S4 — Deliberation (proves G2 is loader-only, not projector) ────────
  it("S4: given branch identities, the projector fans deliberation edges (G2 is a loader gap, not a projector gap)", () => {
    const { a2aEdges } = projectA2aInteractions(
      input({
        deliberations: [
          {
            id: "delib-arch",
            coordinatorAgentId: "build-specialist",
            patternLabel: "Architecture review",
            consensusState: "consensus",
            taskRunId: "TR-DELIB",
            startedAt: at(),
            branches: [
              { nodeId: "b1", agentId: "build-da", workerRole: "reviewer", status: "completed" },
              { nodeId: "b2", agentId: "build-se", workerRole: "skeptical_reviewer", status: "completed" },
            ],
          },
        ],
      }),
    );
    const delib = a2aEdges.filter((e) => e.edgeKind === "a2a-deliberation");
    expect(delib).toHaveLength(2);
    expect(delib.every((e) => e.fromCoworkerId === "build-specialist")).toBe(true);
    expect(delib.map((e) => e.toCoworkerId).sort()).toEqual(["build-da", "build-se"]);
  });

  // ── S6 — Return / completion state ─────────────────────────────────────
  it("S6: completed collaborations render as completed edges", () => {
    const { a2aEdges } = projectA2aInteractions(
      input({
        delegationChains: [delegation("build-specialist", "build-da", "completed")],
        taskLineage: [lineage("consume-orchestrator", "order-fulfillment-agent" /* unknown agent */, "completed")],
      }),
    );
    expect(a2aEdges.find((e) => e.edgeKind === "a2a-delegation")?.state).toBe("completed");
  });

  // ── S7 — Cross-value-stream delegation ─────────────────────────────────
  it("S7: edges span value streams (consume → cross-cutting) without special-casing", () => {
    const { a2aEdges } = projectA2aInteractions(
      input({
        delegationChains: [
          delegation("marketing-specialist", "finance-agent"), // consume → cross-cutting
        ],
        taskLineage: [
          lineage("consume-orchestrator", "build-specialist", "working"), // consume → build
        ],
      }),
    );
    expect(a2aEdges).toHaveLength(2);
    // The projector keys purely on agent identity; value stream is a layout
    // concern, so cross-stream edges project identically to same-stream ones.
    expect(a2aEdges.every((e) => e.fromCoworkerId && e.toCoworkerId)).toBe(true);
  });

  // ── Boundary: S3 / S8 are not projector-level ──────────────────────────
  it("S3/S8 boundary: escalation and tenant isolation are out of the projector's scope", () => {
    // S3 escalation arrives as a queue:escalation AgentEvent (conversational
    // layer); S8 isolation is enforced by the loader's organizationId-scoped
    // query. The projector neither invents escalation edges nor sees cross-org
    // rows — an empty input yields an empty projection, by design.
    const { a2aEdges } = projectA2aInteractions(input());
    expect(a2aEdges).toEqual([]);
  });
});
