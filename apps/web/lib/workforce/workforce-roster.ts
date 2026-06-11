// Unified Workforce roster (BI-554E1A14, EP-BOM-WIRING Phase 2).
//
// The "For Employees" portfolio is too narrow when it means only humans: the AI
// agent workforce (non-human identities) is workforce too. This projection
// returns ONE roster spanning both populations — human EmployeeProfiles and AI
// Agents — so the Workforce portfolio can manage them together.
//
// For AI agents it surfaces the "needs lens": what a non-human identity needs to
// be successful and contribute — its value-stream role, supervising human, HITL
// tier, assigned model + token budget (the agent's cost-to-employ), tool and
// skill counts (its equipment), and unmet capability needs (the gap signal). The
// underlying Agent substrate already carries all of this; this module surfaces it
// under the workforce lens rather than the platform-internals lens.
//
// Pure projection: no schema change, no mutation. The persisted portfolio link
// and the operator UI are separate follow-on slices.

import { prisma } from "@dpf/db";

export type WorkforceMemberKind = "human" | "agent";

/** What an AI agent needs to be successful and contribute. Null for humans. */
export type AgentNeeds = {
  valueStream: string | null;
  /** Supervising human (HR role id), e.g. "HR-000". */
  supervisorId: string | null;
  /** 0=human-only, 1=approve, 2=review, 3=autonomous. */
  hitlTier: number;
  lifecycleStage: string;
  /** Assigned model id, or null when no execution config is set. */
  model: string | null;
  dailyTokenLimit: number | null;
  perTaskTokenLimit: number | null;
  /** Tools the agent is granted (its equipment list). */
  toolGrantCount: number;
  /** Skills assigned to the agent. */
  skillCount: number;
  /** Capability needs the agent has flagged that are not yet resolved. */
  unmetNeedCount: number;
};

export type WorkforceMember = {
  kind: WorkforceMemberKind;
  /** EmployeeProfile.id for humans; Agent.agentId for agents. */
  id: string;
  displayName: string;
  status: string;
  /** Human: position title. Agent: value-stream role. */
  role: string | null;
  /** Human: department name. Agent: portfolio id the agent's work serves. */
  group: string | null;
  /** Present only for AI agents. */
  agentNeeds: AgentNeeds | null;
};

export type WorkforceRosterSummary = {
  total: number;
  humans: number;
  agents: number;
  /** Agents with at least one unmet capability need — the workforce gap signal. */
  agentsWithUnmetNeeds: number;
};

export type WorkforceRoster = {
  members: WorkforceMember[];
  summary: WorkforceRosterSummary;
};

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type WorkforceRosterClient = {
  employeeProfile: { findMany: (args: unknown) => Promise<unknown> };
  agent: { findMany: (args: unknown) => Promise<unknown> };
};

/**
 * Capability-need statuses that count as resolved — an unmet need is any flagged
 * need NOT in this set. Conservative: anything we don't recognize as closed is
 * treated as still-open (so a real gap is never hidden).
 */
const RESOLVED_NEED_STATUSES = new Set(["resolved", "closed", "duplicate", "withdrawn", "rejected"]);

type EmployeeRow = {
  id: string;
  displayName: string;
  status: string;
  position: { title: string } | null;
  department: { name: string } | null;
};

type AgentRow = {
  agentId: string;
  name: string;
  status: string;
  valueStream: string | null;
  humanSupervisorId: string | null;
  hitlTierDefault: number;
  lifecycleStage: string;
  portfolioId: string | null;
  executionConfig: {
    defaultModelId: string | null;
    dailyTokenLimit: number | null;
    perTaskTokenLimit: number | null;
  } | null;
  _count: { toolGrants: number; skills: number };
  coworkerNeeds: Array<{ status: string }>;
};

function humanToMember(row: EmployeeRow): WorkforceMember {
  return {
    kind: "human",
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    role: row.position?.title ?? null,
    group: row.department?.name ?? null,
    agentNeeds: null,
  };
}

function agentToMember(row: AgentRow): WorkforceMember {
  const unmetNeedCount = row.coworkerNeeds.filter(
    (n) => !RESOLVED_NEED_STATUSES.has(n.status),
  ).length;

  return {
    kind: "agent",
    id: row.agentId,
    displayName: row.name,
    status: row.status,
    role: row.valueStream,
    group: row.portfolioId,
    agentNeeds: {
      valueStream: row.valueStream,
      supervisorId: row.humanSupervisorId,
      hitlTier: row.hitlTierDefault,
      lifecycleStage: row.lifecycleStage,
      model: row.executionConfig?.defaultModelId ?? null,
      dailyTokenLimit: row.executionConfig?.dailyTokenLimit ?? null,
      perTaskTokenLimit: row.executionConfig?.perTaskTokenLimit ?? null,
      toolGrantCount: row._count.toolGrants,
      skillCount: row._count.skills,
      unmetNeedCount,
    },
  };
}

/**
 * Load the unified Workforce roster: human employees + AI agents, with the
 * agent-needs lens. Deterministic ordering (humans then agents, each by name).
 */
export async function loadWorkforceRoster(input?: {
  db?: WorkforceRosterClient;
}): Promise<WorkforceRoster> {
  const db = input?.db ?? (prisma as unknown as WorkforceRosterClient);

  const [employees, agents] = await Promise.all([
    db.employeeProfile.findMany({
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        status: true,
        position: { select: { title: true } },
        department: { select: { name: true } },
      },
    }) as Promise<EmployeeRow[]>,
    db.agent.findMany({
      orderBy: { name: "asc" },
      select: {
        agentId: true,
        name: true,
        status: true,
        valueStream: true,
        humanSupervisorId: true,
        hitlTierDefault: true,
        lifecycleStage: true,
        portfolioId: true,
        executionConfig: {
          select: {
            defaultModelId: true,
            dailyTokenLimit: true,
            perTaskTokenLimit: true,
          },
        },
        _count: { select: { toolGrants: true, skills: true } },
        coworkerNeeds: { select: { status: true } },
      },
    }) as Promise<AgentRow[]>,
  ]);

  const humanMembers = employees.map(humanToMember);
  const agentMembers = agents.map(agentToMember);
  const members = [...humanMembers, ...agentMembers];

  return {
    members,
    summary: {
      total: members.length,
      humans: humanMembers.length,
      agents: agentMembers.length,
      agentsWithUnmetNeeds: agentMembers.filter(
        (m) => (m.agentNeeds?.unmetNeedCount ?? 0) > 0,
      ).length,
    },
  };
}
