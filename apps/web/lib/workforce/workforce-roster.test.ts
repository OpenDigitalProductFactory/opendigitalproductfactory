import { describe, expect, it, vi } from "vitest";

import { loadWorkforceRoster } from "./workforce-roster";

function makeDb(opts: { employees?: unknown[]; agents?: unknown[] }) {
  return {
    employeeProfile: { findMany: vi.fn().mockResolvedValue(opts.employees ?? []) },
    agent: { findMany: vi.fn().mockResolvedValue(opts.agents ?? []) },
  };
}

const HUMAN = {
  id: "EMP-1",
  displayName: "Ada Lovelace",
  status: "active",
  position: { title: "Engineer" },
  department: { name: "Product" },
};

const AGENT = {
  agentId: "AGT-COO",
  name: "Chief of Staff",
  status: "active",
  valueStream: "evaluate",
  humanSupervisorId: "HR-000",
  hitlTierDefault: 2,
  lifecycleStage: "production",
  portfolioId: "for_employees",
  executionConfig: {
    defaultModelId: "claude-sonnet-4-6",
    dailyTokenLimit: 200000,
    perTaskTokenLimit: 20000,
  },
  _count: { toolGrants: 5, skills: 3 },
  coworkerNeeds: [{ status: "submitted" }, { status: "resolved" }, { status: "in-progress" }],
};

describe("loadWorkforceRoster (BI-554E1A14)", () => {
  it("unifies humans and agents into one roster", async () => {
    const db = makeDb({ employees: [HUMAN], agents: [AGENT] });

    const { members, summary } = await loadWorkforceRoster({ db: db as never });

    expect(summary).toEqual({
      total: 2,
      humans: 1,
      agents: 1,
      agentsWithUnmetNeeds: 1,
    });
    // humans first, then agents
    expect(members.map((m) => m.kind)).toEqual(["human", "agent"]);
  });

  it("maps a human with no agent-needs lens", async () => {
    const db = makeDb({ employees: [HUMAN], agents: [] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0]).toEqual({
      kind: "human",
      id: "EMP-1",
      displayName: "Ada Lovelace",
      status: "active",
      role: "Engineer",
      group: "Product",
      agentNeeds: null,
    });
  });

  it("surfaces the agent-needs lens (tools/tokens/skills/supervision)", async () => {
    const db = makeDb({ employees: [], agents: [AGENT] });

    const { members } = await loadWorkforceRoster({ db: db as never });
    const agent = members[0];

    expect(agent.kind).toBe("agent");
    expect(agent.id).toBe("AGT-COO");
    expect(agent.role).toBe("evaluate");
    expect(agent.agentNeeds).toEqual({
      valueStream: "evaluate",
      supervisorId: "HR-000",
      hitlTier: 2,
      lifecycleStage: "production",
      model: "claude-sonnet-4-6",
      dailyTokenLimit: 200000,
      perTaskTokenLimit: 20000,
      toolGrantCount: 5,
      skillCount: 3,
      // 2 of 3 needs are not resolved (submitted + in-progress)
      unmetNeedCount: 2,
    });
  });

  it("counts only non-resolved needs as unmet", async () => {
    const allResolved = {
      ...AGENT,
      coworkerNeeds: [{ status: "resolved" }, { status: "closed" }, { status: "duplicate" }],
    };
    const db = makeDb({ employees: [], agents: [allResolved] });

    const { members, summary } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.unmetNeedCount).toBe(0);
    expect(summary.agentsWithUnmetNeeds).toBe(0);
  });

  it("tolerates an agent with no execution config", async () => {
    const noConfig = { ...AGENT, executionConfig: null };
    const db = makeDb({ employees: [], agents: [noConfig] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.model).toBeNull();
    expect(members[0].agentNeeds?.dailyTokenLimit).toBeNull();
    expect(members[0].agentNeeds?.perTaskTokenLimit).toBeNull();
  });

  it("returns an empty roster when there is no workforce", async () => {
    const db = makeDb({ employees: [], agents: [] });

    const { members, summary } = await loadWorkforceRoster({ db: db as never });

    expect(members).toEqual([]);
    expect(summary).toEqual({ total: 0, humans: 0, agents: 0, agentsWithUnmetNeeds: 0 });
  });
});
