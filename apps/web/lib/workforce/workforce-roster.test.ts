import { describe, expect, it, vi } from "vitest";

import { loadWorkforceRoster } from "./workforce-roster";

function makeDb(opts: {
  employees?: unknown[];
  agents?: unknown[];
  roles?: unknown[];
  certificationRuns?: unknown[];
}) {
  return {
    employeeProfile: { findMany: vi.fn().mockResolvedValue(opts.employees ?? []) },
    agent: { findMany: vi.fn().mockResolvedValue(opts.agents ?? []) },
    platformRole: { findMany: vi.fn().mockResolvedValue(opts.roles ?? []) },
    assuranceRun: { findMany: vi.fn().mockResolvedValue(opts.certificationRuns ?? []) },
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

/** A supervising HR role with exactly one active employee holding it. */
const ROLE_SINGLE_HOLDER = {
  roleId: "HR-000",
  name: "Chief Executive Officer",
  users: [
    { user: { isActive: true, employeeProfile: { displayName: "Grace Hopper", status: "active" } } },
  ],
};

describe("loadWorkforceRoster (BI-554E1A14, BI-9A5F0EA3)", () => {
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

  it("surfaces the agent-needs lens (tools/tokens/skills/supervision + parity/owner)", async () => {
    // No platformRole rows returned → owner stays BROAD (the role itself).
    const db = makeDb({ employees: [], agents: [AGENT] });

    const { members } = await loadWorkforceRoster({ db: db as never });
    const agent = members[0];

    expect(agent.kind).toBe("agent");
    expect(agent.id).toBe("AGT-COO");
    expect(agent.role).toBe("evaluate");
    expect(agent.agentNeeds).toEqual({
      valueStream: "evaluate",
      supervisorId: "HR-000",
      humanRoleParity: { roleId: "HR-000", roleName: "HR-000" },
      approvalInterfaceOwner: { scope: "role", label: "HR-000", roleId: "HR-000" },
      hitlTier: 2,
      lifecycleStage: "production",
      model: "claude-sonnet-4-6",
      dailyTokenLimit: 200000,
      perTaskTokenLimit: 20000,
      toolGrantCount: 5,
      skillCount: 3,
      // 2 of 3 needs are not resolved (submitted + in-progress)
      unmetNeedCount: 2,
      // No coworker-cert AssuranceRuns in the fixture → never certified.
      certification: "never",
      certificationAt: null,
    });
  });

  it("surfaces certification state from the latest coworker-cert run (EP-COWORKER-LIFECYCLE P2)", async () => {
    const recent = new Date();
    const db = makeDb({
      employees: [],
      agents: [AGENT],
      certificationRuns: [
        { scopeId: "AGT-COO", status: "passed", startedAt: recent },
        { scopeId: "AGT-COO", status: "failed", startedAt: new Date(recent.getTime() - 86400000) },
      ],
    });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.certification).toBe("certified");
    expect(members[0].agentNeeds?.certificationAt).toEqual(recent);
  });

  it("resolves the human-role parity anchor from the supervising role's name", async () => {
    const db = makeDb({ employees: [], agents: [AGENT], roles: [ROLE_SINGLE_HOLDER] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.humanRoleParity).toEqual({
      roleId: "HR-000",
      roleName: "Chief Executive Officer",
    });
  });

  it("narrows the approval owner to a specific employee when exactly one active person holds the role", async () => {
    const db = makeDb({ employees: [], agents: [AGENT], roles: [ROLE_SINGLE_HOLDER] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    // DOC-7693D528: broad role owner becomes a specific employee as headcount converges.
    expect(members[0].agentNeeds?.approvalInterfaceOwner).toEqual({
      scope: "employee",
      label: "Grace Hopper",
      roleId: "HR-000",
    });
  });

  it("keeps the approval owner BROAD (the role) when zero or many employees hold it", async () => {
    const twoHolders = {
      ...ROLE_SINGLE_HOLDER,
      name: "Approver Pool",
      users: [
        { user: { isActive: true, employeeProfile: { displayName: "A", status: "active" } } },
        { user: { isActive: true, employeeProfile: { displayName: "B", status: "active" } } },
      ],
    };
    const db = makeDb({ employees: [], agents: [AGENT], roles: [twoHolders] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.approvalInterfaceOwner).toEqual({
      scope: "role",
      label: "Approver Pool",
      roleId: "HR-000",
    });
  });

  it("marks the owner unassigned when the coworker has no supervising role", async () => {
    const noSupervisor = { ...AGENT, humanSupervisorId: null };
    const db = makeDb({ employees: [], agents: [noSupervisor] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].agentNeeds?.humanRoleParity).toBeNull();
    expect(members[0].agentNeeds?.approvalInterfaceOwner).toEqual({
      scope: "unassigned",
      label: null,
      roleId: null,
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

  // BI-005DDC70: every agent row on this roster deep-links to
  // /platform/ai/agent/[agentId], which serves ONLY coworkers passing the
  // selection contract. Loading unfiltered put 20 dead links on the page.
  describe("selection contract (links must resolve)", () => {
    it("queries only selectable coworkers (active, not archived, production)", async () => {
      const db = makeDb({ employees: [], agents: [AGENT] });

      await loadWorkforceRoster({ db: db as never });

      expect(db.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "active", archived: false, lifecycleStage: "production" },
        }),
      );
    });

    it("drops a canonical AGT-* row whose executable slug twin is not selectable", async () => {
      // AGT-WS-ADMIN's runtime identity is the `admin-assistant` slug row. When
      // that twin is filtered out by the state predicate, the detail route
      // returns notFound — so the canonical row must not render either.
      const canonicalOnly = { ...AGENT, agentId: "AGT-WS-ADMIN" };
      const db = makeDb({ employees: [], agents: [canonicalOnly] });

      const { members, summary } = await loadWorkforceRoster({ db: db as never });

      expect(members).toEqual([]);
      expect(summary.agents).toBe(0);
    });

    it("shows one row per dual-seed pair, keeping the canonical AGT-* id", async () => {
      const canonical = { ...AGENT, agentId: "AGT-WS-ADMIN" };
      const slugTwin = { ...AGENT, agentId: "admin-assistant" };
      const db = makeDb({ employees: [], agents: [canonical, slugTwin] });

      const { members } = await loadWorkforceRoster({ db: db as never });

      expect(members.map((m) => m.id)).toEqual(["AGT-WS-ADMIN"]);
    });
  });

  it("labels a coworker with its curated displayName, not the raw seed handle", async () => {
    const seeded = { ...AGENT, name: "admin-assistant", displayName: "Platform Admin" };
    const db = makeDb({ employees: [], agents: [seeded] });

    const { members } = await loadWorkforceRoster({ db: db as never });

    expect(members[0].displayName).toBe("Platform Admin");
  });

  it("returns an empty roster when there is no workforce", async () => {
    const db = makeDb({ employees: [], agents: [] });

    const { members, summary } = await loadWorkforceRoster({ db: db as never });

    expect(members).toEqual([]);
    expect(summary).toEqual({ total: 0, humans: 0, agents: 0, agentsWithUnmetNeeds: 0 });
  });
});
