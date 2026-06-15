// Deterministic Operations Map topology fixture (Stage 0 parity baseline).
//
// Shared by the pure layout-model tests and future OperationsTopologyCanvas
// parity tests so the unified canvas can prove parity against a fixed input
// rather than human visual memory. See
// docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md §7 Stage 0.
//
// Contents (per the spec's required shape):
//   - 3 coworkers, 2 providers
//   - active / failover / scheduled / historical routes
//   - delegation / handoff / task-lineage A2A edges
//   - at least one marker without a coworkerId (preserves "Coworker missing")

import type {
  OperationsMapRoutingTopology,
} from "@/lib/ai-operations-map/types";

const T0 = "2026-06-05T10:00:00.000Z";
const T1 = "2026-06-05T10:05:00.000Z";
const T2 = "2026-06-05T10:10:00.000Z";
const T3 = "2026-06-05T10:15:00.000Z";

export function buildOperationsMapTopologyFixture(
  overrides: Partial<OperationsMapRoutingTopology> = {},
): OperationsMapRoutingTopology {
  const base: OperationsMapRoutingTopology = {
    coworkers: [
      { agentId: "ceo-coworker", label: "CEO Coworker", stationLabel: "Direct" },
      { agentId: "build-specialist", label: "Build Specialist", stationLabel: "Build" },
      { agentId: "brand-analyst", label: "Brand Analyst", stationLabel: "Brand" },
    ],
    providers: [
      { providerId: "anthropic", label: "Claude", status: "active", kind: "cloud", providerType: "llm", costUsd: 1.5, tokenTotal: 12000, decisionCount: 2 },
      { providerId: "openai", label: "OpenAI / Codex", status: "active", kind: "cli", providerType: "llm", costUsd: 0.8, tokenTotal: 6000, decisionCount: 1 },
    ],
    routes: [
      { id: "route:active", coworkerId: "ceo-coworker", providerId: "anthropic", state: "active", label: "CEO Coworker to Claude", summary: "reasoning routed to claude-sonnet", occurredAt: T2, decisionId: "d1", trafficWeight: 3, markerIds: ["marker:d1:decision"] },
      { id: "route:failover", coworkerId: "build-specialist", providerId: "openai", state: "failover", label: "Build Specialist failover via OpenAI / Codex", summary: "provider 5xx, fell back", occurredAt: T1, decisionId: "d2", trafficWeight: 1, markerIds: ["marker:d2:error"] },
      { id: "route:scheduled", coworkerId: "brand-analyst", providerId: "anthropic", state: "scheduled", label: "Brand Analyst scheduled", summary: "scheduled provider routing", occurredAt: T3, decisionId: null, trafficWeight: 1, markerIds: [] },
      { id: "route:historical", coworkerId: "ceo-coworker", providerId: "openai", state: "historical", label: "CEO Coworker historical via OpenAI / Codex", summary: "past route", occurredAt: T0, decisionId: "d0", trafficWeight: 2, markerIds: [] },
    ],
    a2aEdges: [
      { id: "a2a:delegation:1", edgeKind: "a2a-delegation", fromCoworkerId: "ceo-coworker", toCoworkerId: "brand-analyst", state: "active", label: "Delegated brand-extract", summary: "Delegated brand extraction", occurredAt: T0, authorityScope: ["brand:read", "brand:write"], skillId: "brand-extract", refs: { delegationChainId: "del-1" }, weight: 2 },
      { id: "a2a:handoff:1", edgeKind: "a2a-handoff", fromCoworkerId: "build-specialist", toCoworkerId: "brand-analyst", state: "completed", label: "Handoff plan → build", summary: "Plan approved", occurredAt: T1, buildId: "FB-1", gateResult: "plan gate passed", refs: { phaseHandoffId: "ph-1" }, weight: 3 },
      { id: "a2a:lineage:1", edgeKind: "a2a-task-lineage", fromCoworkerId: "ceo-coworker", toCoworkerId: "build-specialist", state: "failed", label: "Ship landing page", summary: "Produce and ship", occurredAt: T2, refs: { taskRunId: "TR-1" }, weight: 2 },
    ],
    markers: [
      { id: "marker:d1:decision", type: "decision", label: "Route decision", summary: "selected claude-sonnet", routeId: "route:active", coworkerId: "ceo-coworker", providerId: "anthropic", occurredAt: T2 },
      { id: "marker:d2:error", type: "error", label: "Error / outage", summary: "provider 5xx", routeId: "route:failover", coworkerId: "build-specialist", providerId: "openai", occurredAt: T1 },
      // Provider-side marker with NO coworker id — exercises the existing
      // "Coworker missing" / router-audit handling that must survive cutover.
      { id: "marker:unattributed", type: "decision", label: "Unattributed route decision", summary: "router audit only", routeId: null, coworkerId: null, providerId: "anthropic", occurredAt: T3 },
    ],
    timeline: [
      { id: "timeline:d0", lane: "history", label: "reasoning", occurredAt: T0, markerType: "decision" },
      { id: "timeline:d1", lane: "history", label: "reasoning", occurredAt: T2, markerType: "decision" },
      { id: "timeline:sched", lane: "future", label: "Scheduled", occurredAt: T3, markerType: "scheduled" },
    ],
    deliberations: [],
    legend: [
      { state: "active", label: "Selected active route", description: "The provider selected by the latest route decision." },
      { state: "failover", label: "Failover or degraded route", description: "Fallback/error/degraded operation." },
    ],
    a2aLegend: [
      { edgeKind: "a2a-delegation", label: "Delegation", description: "Authority-bearing delegation." },
      { edgeKind: "a2a-handoff", label: "Phase handoff", description: "Build phase handoff." },
      { edgeKind: "a2a-task-lineage", label: "Task lineage", description: "Task lineage." },
      { edgeKind: "a2a-deliberation", label: "Deliberation", description: "Peer review fan-out." },
    ],
  };

  return { ...base, ...overrides };
}
