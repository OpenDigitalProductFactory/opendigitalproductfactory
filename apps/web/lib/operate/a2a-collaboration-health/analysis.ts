/**
 * Pure A2A collaboration health analysis (BI-3003EE63).
 *
 * Operates on in-memory edge events (no I/O) so unit tests stay hermetic.
 * Mirrors the MCP call-efficiency analyzer shape (BI-A08EBAEC) for the
 * coworker↔coworker plane: failed/blocked edges, stuck delegations, orphan
 * lineage, and sparse capture honesty.
 *
 * Does not fabricate deliberation identity — callers only pass edges with
 * known agent endpoints.
 */

import { EFFICIENCY_PLANE_MAPPING } from "./dimensions";

export type CollaborationEdgeKind =
  | "a2a-delegation"
  | "a2a-handoff"
  | "a2a-task-lineage"
  | "a2a-deliberation";

export type CollaborationEdgeState =
  | "active"
  | "completed"
  | "failed"
  | "blocked"
  | "unknown";

export type CollaborationEdgeEvent = {
  id: string;
  edgeKind: CollaborationEdgeKind;
  fromAgentId: string;
  toAgentId: string;
  state: CollaborationEdgeState;
  occurredAt: Date;
  completedAt?: Date | null;
  /** Present when lineage claims a parent task but parent agent could not be resolved. */
  orphanParent?: boolean;
  skillId?: string | null;
  title?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
};

export type CollaborationFindingKind =
  | "failed_edge"
  | "blocked_edge"
  | "stuck_active"
  | "orphan_lineage"
  | "pair_failure_rate";

export type CollaborationActionKind =
  | "fix_capture"
  | "investigate_handoff"
  | "clear_stuck_delegation"
  | "improve_gate"
  | "investigate";

export type CollaborationFinding = {
  kind: CollaborationFindingKind;
  severity: "info" | "warning" | "critical";
  edgeKind: CollaborationEdgeKind | "any";
  title: string;
  detail: string;
  evidence: {
    count: number;
    fromAgentId?: string;
    toAgentId?: string;
    sampleIds: string[];
  };
  recommendedAction: CollaborationActionKind;
  wasteEdgeEstimate: number;
};

export type CollaborationHealthReport = {
  windowStart: string;
  windowEnd: string;
  totalEdges: number;
  successRate: number;
  byKind: Array<{
    edgeKind: CollaborationEdgeKind;
    count: number;
    failed: number;
    blocked: number;
    active: number;
  }>;
  topPairs: Array<{
    fromAgentId: string;
    toAgentId: string;
    count: number;
    failedOrBlocked: number;
    successRate: number;
  }>;
  findings: CollaborationFinding[];
  /** Operator-facing: whether edge density supports optimization claims. */
  ledgerSufficiency: {
    usable: boolean;
    note: string;
  };
  /** Shared dimension plane id for MCP twin reports. */
  plane: typeof EFFICIENCY_PLANE_MAPPING.a2a.plane;
};

export type AnalyzeCollaborationHealthOptions = {
  /** Min edges for usable ledger. Default 5. */
  minEdgesForUsable?: number;
  /** Active longer than this (ms) → stuck_active. Default 4h. */
  stuckActiveMs?: number;
  /** Pair total samples for pair_failure_rate. Default 4. */
  pairFailureMinSamples?: number;
  /** Fail+blocked rate (0–1) for pair_failure_rate. Default 0.5. */
  pairFailureRate?: number;
  /** Max findings. Default 25. */
  maxFindings?: number;
  /** Wall clock for stuck detection (tests inject). Default Date.now(). */
  nowMs?: number;
};

function severityRank(s: CollaborationFinding["severity"]): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}

function isBadState(state: CollaborationEdgeState): boolean {
  return state === "failed" || state === "blocked";
}

function pairKey(from: string, to: string): string {
  return `${from}→${to}`;
}

/**
 * Analyze a bag of A2A edge events and produce ranked collaboration findings.
 */
export function analyzeCollaborationHealth(
  events: CollaborationEdgeEvent[],
  opts: AnalyzeCollaborationHealthOptions = {},
): CollaborationHealthReport {
  const minEdgesForUsable = opts.minEdgesForUsable ?? 5;
  const stuckActiveMs = opts.stuckActiveMs ?? 4 * 60 * 60 * 1000;
  const pairFailureMinSamples = opts.pairFailureMinSamples ?? 4;
  const pairFailureRate = opts.pairFailureRate ?? 0.5;
  const maxFindings = opts.maxFindings ?? 25;
  const nowMs = opts.nowMs ?? Date.now();

  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const windowStart =
    sorted[0]?.occurredAt.toISOString() ?? new Date(0).toISOString();
  const windowEnd =
    sorted[sorted.length - 1]?.occurredAt.toISOString() ??
    new Date(0).toISOString();

  const totalEdges = sorted.length;
  const goodCount = sorted.filter((e) => e.state === "completed").length;
  const successRate = totalEdges > 0 ? goodCount / totalEdges : 1;

  const kindOrder: CollaborationEdgeKind[] = [
    "a2a-delegation",
    "a2a-handoff",
    "a2a-task-lineage",
    "a2a-deliberation",
  ];
  const kindMap = new Map<
    CollaborationEdgeKind,
    { count: number; failed: number; blocked: number; active: number }
  >();
  for (const k of kindOrder) {
    kindMap.set(k, { count: 0, failed: 0, blocked: 0, active: 0 });
  }
  for (const e of sorted) {
    const row = kindMap.get(e.edgeKind) ?? {
      count: 0,
      failed: 0,
      blocked: 0,
      active: 0,
    };
    row.count += 1;
    if (e.state === "failed") row.failed += 1;
    if (e.state === "blocked") row.blocked += 1;
    if (e.state === "active") row.active += 1;
    kindMap.set(e.edgeKind, row);
  }
  const byKind = kindOrder.map((edgeKind) => ({
    edgeKind,
    ...(kindMap.get(edgeKind) ?? {
      count: 0,
      failed: 0,
      blocked: 0,
      active: 0,
    }),
  }));

  const pairMap = new Map<
    string,
    {
      fromAgentId: string;
      toAgentId: string;
      count: number;
      failedOrBlocked: number;
    }
  >();
  for (const e of sorted) {
    if (!e.fromAgentId || !e.toAgentId) continue;
    const key = pairKey(e.fromAgentId, e.toAgentId);
    const row = pairMap.get(key) ?? {
      fromAgentId: e.fromAgentId,
      toAgentId: e.toAgentId,
      count: 0,
      failedOrBlocked: 0,
    };
    row.count += 1;
    if (isBadState(e.state)) row.failedOrBlocked += 1;
    pairMap.set(key, row);
  }
  const topPairs = Array.from(pairMap.values())
    .map((v) => ({
      fromAgentId: v.fromAgentId,
      toAgentId: v.toAgentId,
      count: v.count,
      failedOrBlocked: v.failedOrBlocked,
      successRate:
        v.count > 0 ? (v.count - v.failedOrBlocked) / v.count : 1,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const findings: CollaborationFinding[] = [];

  // Failed edges (global + sample)
  const failed = sorted.filter((e) => e.state === "failed");
  if (failed.length > 0) {
    findings.push({
      kind: "failed_edge",
      severity: failed.length >= 5 ? "critical" : "warning",
      edgeKind: "any",
      title: `Failed A2A edges: ${failed.length}`,
      detail:
        `${failed.length} coworker↔coworker edge(s) ended failed in the window. ` +
        `Inspect handoff gates, delegation status, and task lineage failures.`,
      evidence: {
        count: failed.length,
        sampleIds: failed.slice(0, 5).map((e) => e.id),
      },
      recommendedAction: "investigate_handoff",
      wasteEdgeEstimate: failed.length,
    });
  }

  // Blocked edges
  const blocked = sorted.filter((e) => e.state === "blocked");
  if (blocked.length > 0) {
    findings.push({
      kind: "blocked_edge",
      severity: blocked.length >= 5 ? "critical" : "warning",
      edgeKind: "any",
      title: `Blocked A2A edges: ${blocked.length}`,
      detail:
        `${blocked.length} edge(s) are blocked (e.g. phase gate failure or canceled task). ` +
        `Fix gate criteria or clear blocked handoffs.`,
      evidence: {
        count: blocked.length,
        sampleIds: blocked.slice(0, 5).map((e) => e.id),
      },
      recommendedAction: "improve_gate",
      wasteEdgeEstimate: blocked.length,
    });
  }

  // Stuck active delegations
  const stuck = sorted.filter((e) => {
    if (e.edgeKind !== "a2a-delegation" || e.state !== "active") return false;
    const age = nowMs - e.occurredAt.getTime();
    return age >= stuckActiveMs;
  });
  if (stuck.length > 0) {
    findings.push({
      kind: "stuck_active",
      severity: stuck.length >= 3 ? "critical" : "warning",
      edgeKind: "a2a-delegation",
      title: `Stuck active delegations: ${stuck.length}`,
      detail:
        `${stuck.length} delegation(s) still active longer than ${Math.round(stuckActiveMs / 3600000)}h. ` +
        `Complete, fail, or cancel the chain so authority envelopes do not linger.`,
      evidence: {
        count: stuck.length,
        sampleIds: stuck.slice(0, 5).map((e) => e.id),
        fromAgentId: stuck[0]?.fromAgentId,
        toAgentId: stuck[0]?.toAgentId,
      },
      recommendedAction: "clear_stuck_delegation",
      wasteEdgeEstimate: stuck.length,
    });
  }

  // Orphan lineage
  const orphans = sorted.filter(
    (e) => e.edgeKind === "a2a-task-lineage" && e.orphanParent === true,
  );
  if (orphans.length > 0) {
    findings.push({
      kind: "orphan_lineage",
      severity: orphans.length >= 3 ? "critical" : "warning",
      edgeKind: "a2a-task-lineage",
      title: `Orphan task lineage: ${orphans.length}`,
      detail:
        `${orphans.length} task lineage row(s) reference a parent task without a resolvable parent agent. ` +
        `Improve capture of parent/initiating agent ids (BI-9DB7C332).`,
      evidence: {
        count: orphans.length,
        sampleIds: orphans.slice(0, 5).map((e) => e.id),
      },
      recommendedAction: "fix_capture",
      wasteEdgeEstimate: orphans.length,
    });
  }

  // Pair failure rate
  for (const p of topPairs) {
    if (p.count < pairFailureMinSamples) continue;
    const rate = p.failedOrBlocked / p.count;
    if (rate < pairFailureRate) continue;
    findings.push({
      kind: "pair_failure_rate",
      severity: rate >= 0.75 ? "critical" : "warning",
      edgeKind: "any",
      title: `Pair failure rate: ${p.fromAgentId} → ${p.toAgentId} (${(rate * 100).toFixed(0)}%)`,
      detail:
        `${p.failedOrBlocked}/${p.count} edges between this coworker pair failed or blocked. ` +
        `Review authority, skills, or phase gates on that path.`,
      evidence: {
        count: p.count,
        fromAgentId: p.fromAgentId,
        toAgentId: p.toAgentId,
        sampleIds: sorted
          .filter(
            (e) =>
              e.fromAgentId === p.fromAgentId &&
              e.toAgentId === p.toAgentId &&
              isBadState(e.state),
          )
          .slice(0, 5)
          .map((e) => e.id),
      },
      recommendedAction: "investigate_handoff",
      wasteEdgeEstimate: p.failedOrBlocked,
    });
  }

  findings.sort((a, b) => {
    const sr = severityRank(a.severity) - severityRank(b.severity);
    if (sr !== 0) return sr;
    return b.wasteEdgeEstimate - a.wasteEdgeEstimate;
  });

  const usable = totalEdges >= minEdgesForUsable;
  return {
    windowStart,
    windowEnd,
    totalEdges,
    successRate,
    byKind,
    topPairs,
    findings: findings.slice(0, maxFindings),
    ledgerSufficiency: {
      usable,
      note: usable
        ? "A2A edge volume is sufficient for failure/stuck/orphan findings. Sparse capture still under-reports real collaboration (see BI-9DB7C332)."
        : "Too few coworker↔coworker edges in window for reliable collaboration optimization; do not claim healthy multi-agent ops from empty capture.",
    },
    plane: EFFICIENCY_PLANE_MAPPING.a2a.plane,
  };
}
