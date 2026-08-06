import { describe, expect, it } from "vitest";
import { loadWorkforceActivity } from "./workforce-activity";

const NOW = Date.UTC(2026, 7, 5, 15, 0, 0); // 2026-08-05T15:00Z

function agent(over: Partial<Record<string, unknown>>) {
  return {
    agentId: "a",
    name: "A",
    displayName: null,
    valueStream: "integrate",
    humanSupervisorId: "HR-100",
    hitlTierDefault: 3,
    ...over,
  };
}

/** A Prisma double that answers the reads the loader makes. */
function fakePrisma(data: {
  agents: unknown[];
  liveRuns?: unknown[];
  toolByAgentTool?: unknown[];
  lastActed?: unknown[];
  tokens?: unknown[];
  delegated?: unknown[];
  handoffs?: unknown[];
  evidence?: unknown[];
}) {
  return {
    agent: { findMany: async () => data.agents },
    taskRun: { findMany: async () => data.liveRuns ?? [] },
    toolExecution: {
      groupBy: async (args: { by: string[] }) =>
        args.by.includes("toolName") ? (data.toolByAgentTool ?? []) : (data.lastActed ?? []),
    },
    tokenUsage: { groupBy: async () => data.tokens ?? [] },
    delegationChain: { groupBy: async () => data.delegated ?? [] },
    phaseHandoff: { groupBy: async () => data.handoffs ?? [] },
    backlogItemActivity: { groupBy: async () => data.evidence ?? [] },
  } as never;
}

describe("loadWorkforceActivity", () => {
  it("splits working vs quiet and builds the outcome digest", async () => {
    const prisma = fakePrisma({
      agents: [
        agent({ agentId: "build-specialist", displayName: "Build Lead", valueStream: "integrate" }),
        agent({ agentId: "compliance-officer", displayName: "Compliance Officer", valueStream: "cross-cutting" }),
      ],
      liveRuns: [
        { taskRunId: "t1", status: "working", title: "Building the cockpit", currentAgentId: "build-specialist", startedAt: new Date(NOW - 600000), lastHeartbeatAt: new Date(NOW - 1000) },
      ],
      toolByAgentTool: [
        { agentId: "build-specialist", toolName: "create_portal_pr", _count: { _all: 2 } },
        { agentId: "build-specialist", toolName: "get_backlog_item", _count: { _all: 9 } },
      ],
      lastActed: [
        { agentId: "compliance-officer", _max: { createdAt: new Date(NOW - 8 * 86_400_000) } },
      ],
      tokens: [
        { agentId: "build-specialist", _sum: { inputTokens: 1000, outputTokens: 240, costUsd: 0.5 } },
      ],
    });

    const wf = await loadWorkforceActivity({ prisma, now: () => NOW });

    expect(wf.working.map((c) => c.name)).toEqual(["Build Lead"]);
    expect(wf.working[0].now?.title).toBe("Building the cockpit");
    // read tool excluded; write tool becomes an outcome
    expect(wf.working[0].didToday).toEqual([{ label: "PRs opened", count: 2, sensitive: false }]);
    expect(wf.working[0].tokensToday).toBe(1240);

    expect(wf.quiet.map((c) => c.name)).toEqual(["Compliance Officer"]);
    expect(wf.quiet[0].now).toBeNull();
    expect(wf.quiet[0].lastActedAt).toBe(new Date(NOW - 8 * 86_400_000).toISOString());

    expect(wf.pulse.workingCount).toBe(1);
    expect(wf.pulse.totalCount).toBe(2);
    expect(wf.pulse.quietOverThresholdCount).toBe(1); // compliance last acted 8d ago > 5d
  });

  it("flags sensitive-data activity as an aggregate signal (no detail leak)", async () => {
    const prisma = fakePrisma({
      agents: [agent({ agentId: "hr-specialist", displayName: "People Partner", valueStream: "operate" })],
      liveRuns: [
        { taskRunId: "t2", status: "working", title: "Onboarding", currentAgentId: "hr-specialist", startedAt: new Date(NOW), lastHeartbeatAt: new Date(NOW) },
      ],
      toolByAgentTool: [
        { agentId: "hr-specialist", toolName: "update_employee", _count: { _all: 4 } },
        { agentId: "hr-specialist", toolName: "create_backlog_item", _count: { _all: 1 } },
      ],
    });
    const wf = await loadWorkforceActivity({ prisma, now: () => NOW });
    const hr = wf.working[0];
    expect(hr.handlesSensitive).toBe(true);
    expect(hr.sensitiveActionCount).toBe(4);
    // the digest is counts only — a category label, never record content
    expect(hr.didToday.find((o) => o.sensitive)?.label).toBe("employee records updated");
  });

  it("counts coworkers with no human owner as a governance gap", async () => {
    const prisma = fakePrisma({
      agents: [
        agent({ agentId: "owned", humanSupervisorId: "HR-100" }),
        agent({ agentId: "orphan", humanSupervisorId: null }),
      ],
    });
    const wf = await loadWorkforceActivity({ prisma, now: () => NOW });
    expect(wf.pulse.coworkersWithoutOwnerCount).toBe(1);
    expect(wf.quiet.find((c) => c.agentId === "orphan")?.humanSupervisorId).toBeNull();
  });

  it("excludes background/permission executionModes from the outcome query (BI-A1B4BE05)", async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const prisma = {
      agent: { findMany: async () => [agent({ agentId: "a" })] },
      taskRun: { findMany: async () => [] },
      toolExecution: {
        groupBy: async (args: { where: Record<string, unknown> }) => {
          wheres.push(args.where);
          return [];
        },
      },
      tokenUsage: { groupBy: async () => [] },
      delegationChain: { groupBy: async () => [] },
      phaseHandoff: { groupBy: async () => [] },
      backlogItemActivity: { groupBy: async () => [] },
    } as never;
    await loadWorkforceActivity({ prisma, now: () => NOW });
    // the tool-by-tool outcome query is the one filtered to success:true
    const outcomeWhere = wheres.find((w) => w.success === true);
    expect(outcomeWhere?.executionMode).toEqual({ notIn: ["background", "permission"] });
  });

  it("folds A2A delegations, handoffs, and backlog evidence into 'did today' (BI-3D37CE9D)", async () => {
    const prisma = fakePrisma({
      agents: [agent({ agentId: "orch", displayName: "Orchestrator" })],
      liveRuns: [
        { taskRunId: "t", status: "active", title: "coordinating", currentAgentId: "orch", startedAt: new Date(NOW), lastHeartbeatAt: new Date(NOW) },
      ],
      toolByAgentTool: [{ agentId: "orch", toolName: "create_backlog_item", _count: { _all: 1 } }],
      delegated: [{ fromAgentId: "orch", _count: { _all: 3 } }],
      handoffs: [{ fromAgentId: "orch", _count: { _all: 2 } }],
      evidence: [{ recordedByAgentId: "orch", _count: { _all: 4 } }],
    });
    const wf = await loadWorkforceActivity({ prisma, now: () => NOW });
    const labels = wf.working[0].didToday.map((o) => o.label);
    expect(labels).toContain("delegations");
    expect(labels).toContain("handoffs");
    expect(labels).toContain("evidence logged");
    // the tool-derived outcome is still present alongside the folded-in ones
    expect(labels).toContain("backlog item filed");
    // and the non-tool outcomes are ranked in (evidence:4 is the top count)
    expect(wf.working[0].didToday[0].label).toBe("evidence logged");
  });

  it("orders working by tokens spent today, busiest first", async () => {
    const prisma = fakePrisma({
      agents: [agent({ agentId: "a1", displayName: "A1" }), agent({ agentId: "a2", displayName: "A2" })],
      liveRuns: [
        { taskRunId: "t1", status: "active", title: "x", currentAgentId: "a1", startedAt: new Date(NOW), lastHeartbeatAt: new Date(NOW) },
        { taskRunId: "t2", status: "active", title: "y", currentAgentId: "a2", startedAt: new Date(NOW), lastHeartbeatAt: new Date(NOW) },
      ],
      tokens: [
        { agentId: "a1", _sum: { inputTokens: 10, outputTokens: 0, costUsd: 0 } },
        { agentId: "a2", _sum: { inputTokens: 900, outputTokens: 100, costUsd: 0 } },
      ],
    });
    const wf = await loadWorkforceActivity({ prisma, now: () => NOW });
    expect(wf.working.map((c) => c.name)).toEqual(["A2", "A1"]);
  });
});
