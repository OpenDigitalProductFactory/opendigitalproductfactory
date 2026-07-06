// Queue-awareness tool pack — EP-3516E23D Phase 3 (BI-FD56CC6A).
//
// Read-only coworker surface over the shared queue flow-telemetry. Lets an AI
// coworker answer "how is queue X doing?" — depth, wait/cycle time, throughput,
// first-pass yield (% correct), SLA attainment — from the SAME QueueMetricSnapshot
// rows the human tiles render, so human and coworker never argue from different
// numbers (spec §4.5). Handlers lazy-import the snapshot service so this pack
// pulls no heavy modules at registration. Grants mirror agent-grants.ts
// TOOL_TO_GRANTS.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_queue_status",
    description:
      "Read the current flow metrics for one queue (or all queues) — depth, wait/process/cycle time percentiles, throughput, first-pass yield, SLA attainment, and a health verdict. Use before prioritizing work or when asked how a queue or the platform's scarce resources are doing. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        queueKey: {
          type: "string",
          description:
            "Optional stable queue key (e.g. 'cwq:triage-default', 'compute:sandbox-pool'). Omit to list every queue with a snapshot today, most-backed-up first.",
        },
        limit: { type: "number", description: "Max queues to return (default 50, max 200)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_at_risk_queues",
    description:
      "List only the queues currently assessed at-risk — a deep backlog, low first-pass yield, missed SLA, or high abandonment — with the reasons. Use to decide where attention or capacity should go. Read-only.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

function ms(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(0)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

async function getQueueStatusHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { readQueueSnapshots, assessQueueHealth } = await import(
    "@/lib/queue/queue-snapshot-service"
  );
  const queueKey = typeof params["queueKey"] === "string" ? params["queueKey"].trim() : undefined;
  const limit = typeof params["limit"] === "number" ? params["limit"] : undefined;
  const snapshots = await readQueueSnapshots({ queueKey: queueKey || undefined, limit });

  if (snapshots.length === 0) {
    return {
      success: true,
      message: queueKey
        ? `No flow-metric snapshot yet for queue ${queueKey} today. Either nothing has flowed through it, or the hourly rollup has not run since its first event.`
        : "No queue flow-metric snapshots for today yet.",
      data: { queues: [] },
    };
  }

  const queues = snapshots.map((s) => {
    const { health, reasons } = assessQueueHealth(s);
    return {
      queueKey: s.queueKey,
      health,
      reasons,
      depth: s.depth,
      wip: s.wip,
      arrivals: s.arrivals,
      throughput: s.throughput,
      waitP50: ms(s.waitP50Ms),
      waitP95: ms(s.waitP95Ms),
      cycleP50: ms(s.cycleP50Ms),
      cycleP95: ms(s.cycleP95Ms),
      firstPassYield: pct(s.firstPassYield),
      slaAttainment: pct(s.slaAttainment),
      abandonment: pct(s.abandonmentRate),
      computedAt: s.computedAt,
    };
  });

  const summary = queueKey
    ? `Queue ${queueKey}: ${queues[0]!.health}, depth ${queues[0]!.depth}, p95 wait ${queues[0]!.waitP95}, throughput ${queues[0]!.throughput}, first-pass yield ${queues[0]!.firstPassYield}.`
    : `${queues.length} queue(s) with activity today. ${
        queues.filter((q) => q.health === "at-risk").length
      } at-risk.`;

  return { success: true, message: summary, data: { queues } };
}

async function listAtRiskQueuesHandler(): Promise<ToolResult> {
  const { readAtRiskQueues } = await import("@/lib/queue/queue-snapshot-service");
  const atRisk = await readAtRiskQueues();
  if (atRisk.length === 0) {
    return { success: true, message: "No queues are at-risk right now.", data: { queues: [] } };
  }
  const queues = atRisk.map(({ snapshot, assessment }) => ({
    queueKey: snapshot.queueKey,
    reasons: assessment.reasons,
    depth: snapshot.depth,
    waitP95: ms(snapshot.waitP95Ms),
    firstPassYield: pct(snapshot.firstPassYield),
    slaAttainment: pct(snapshot.slaAttainment),
  }));
  return {
    success: true,
    message: `${queues.length} at-risk queue(s): ${queues.map((q) => q.queueKey).join(", ")}.`,
    data: { queues },
  };
}

export const queueAwarenessPack: ToolPack = {
  packId: "queue-awareness",
  definitions,
  handlers: {
    get_queue_status: (params) => getQueueStatusHandler(params),
    list_at_risk_queues: () => listAtRiskQueuesHandler(),
  },
  // Grants mirror agent-grants.ts TOOL_TO_GRANTS. Queue status is platform-
  // coordination visibility, so it rides the same read grant as the sibling
  // ops-read tool get_runtime_coordination_map (work_capsule_read) — any
  // coworker that can read platform coordination state can read queue health,
  // with no new grant to seed.
  grants: {
    get_queue_status: ["work_capsule_read"],
    list_at_risk_queues: ["work_capsule_read"],
  },
};
