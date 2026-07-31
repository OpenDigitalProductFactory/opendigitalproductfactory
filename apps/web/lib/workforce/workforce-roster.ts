// Unified Workforce roster (BI-554E1A14 + BI-9A5F0EA3, EP-BOM-WIRING).
//
// The "For Employees" portfolio is too narrow when it means only humans: the AI
// coworker workforce (non-human identities) is workforce too. This projection
// returns ONE roster spanning both populations — human EmployeeProfiles and AI
// Agents — so the Workforce portfolio can manage them together.
//
// For AI coworkers it surfaces the "needs lens": what a non-human identity needs
// to be successful and contribute — its value-stream role, supervising human,
// HITL tier, assigned model + token budget (the coworker's cost-to-employ), tool
// and skill counts (its equipment), and unmet capability needs (the gap signal).
//
// Per the founder-reviewed invariant DOC-7693D528, each AI coworker is a
// role-shaped non-human peer: it also exposes its human-role parity anchor (the
// equivalent/adjacent human role it is patterned against) and its current
// approval/interface owner (the responsible human). That ownership starts BROAD
// (an HR role) in a small org and becomes SPECIFIC (a named employee) as headcount
// grows and exactly one person holds the supervising role — resolved live here,
// with no parallel identity substrate.
//
// Pure projection: no schema change, no mutation.

import { prisma } from "@dpf/db";
import {
  loadCertificationStates,
  type CoworkerCertificationState,
} from "@/lib/coworker-lifecycle/certification-status";
import {
  SELECTABLE_COWORKER_STATE,
  dropDualSeedAliasAgents,
} from "@/lib/coworker-record/selectable-coworker";

export type WorkforceMemberKind = "human" | "agent";

/**
 * The equivalent/adjacent human role an AI coworker is patterned against
 * (DOC-7693D528). Null when the coworker has no supervising human role set.
 */
export type HumanRoleParity = {
  /** HR role id, e.g. "HR-100". */
  roleId: string;
  /** Human-readable role name, e.g. "Chief Revenue Officer" (falls back to roleId). */
  roleName: string;
} | null;

/**
 * The responsible human for an AI coworker's approval, supervision, escalation,
 * and day-to-day interface. Scope widens/narrows with headcount:
 *  - "employee"   — exactly one active employee holds the supervising role (specific)
 *  - "role"       — the supervising HR role, held by zero or many (broad)
 *  - "unassigned" — no supervising role is set
 */
export type ApprovalInterfaceOwner = {
  scope: "employee" | "role" | "unassigned";
  /** Employee display name (employee), role name (role), or null (unassigned). */
  label: string | null;
  /** The supervising HR role id, when one is set. */
  roleId: string | null;
};

/** What an AI coworker needs to be successful and contribute. Null for humans. */
export type AgentNeeds = {
  valueStream: string | null;
  /** Supervising human (HR role id), e.g. "HR-000". */
  supervisorId: string | null;
  /** The equivalent/adjacent human role this coworker is patterned against. */
  humanRoleParity: HumanRoleParity;
  /** The responsible human owner for approval/interface (broad → specific). */
  approvalInterfaceOwner: ApprovalInterfaceOwner;
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
  /**
   * Behavioral certification state from the nightly coworker-cert sweep
   * (EP-COWORKER-LIFECYCLE Phase 2): certified | failed | stale | never.
   * "never" for agents outside the certified roster or before the first sweep.
   */
  certification: "certified" | "failed" | "stale" | "never";
  certificationAt: Date | null;
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
  /** Present only for AI coworkers. */
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
  /** Optional — resolves the specific/broad approval owner for supervising roles. */
  platformRole?: { findMany: (args: unknown) => Promise<unknown> };
  /** Optional — latest coworker-cert AssuranceRuns for certification status. */
  assuranceRun?: { findMany: (args: unknown) => Promise<unknown> };
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
  /** Curated role label (AGENT_IDENTITY_OVERRIDES); falls back to the seed name. */
  displayName?: string | null;
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

type PlatformRoleRow = {
  roleId: string;
  name: string;
  users: Array<{
    user: {
      isActive: boolean;
      employeeProfile: { displayName: string; status: string } | null;
    } | null;
  }>;
};

/** Resolution for one supervising HR role: its name + the active employees holding it. */
type RoleResolution = { roleName: string; activeHolderNames: string[] };

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

/**
 * Derive an AI coworker's human-role parity anchor and current approval/interface
 * owner from its supervising HR role. Ownership is BROAD (the role) until exactly
 * one active employee holds that role, at which point it becomes SPECIFIC (that
 * employee) — the DOC-7693D528 scale-with-headcount invariant.
 */
function resolveParityAndOwner(
  supervisorId: string | null,
  roles: Map<string, RoleResolution>,
): { humanRoleParity: HumanRoleParity; approvalInterfaceOwner: ApprovalInterfaceOwner } {
  if (!supervisorId) {
    return {
      humanRoleParity: null,
      approvalInterfaceOwner: { scope: "unassigned", label: null, roleId: null },
    };
  }

  const resolved = roles.get(supervisorId);
  const roleName = resolved?.roleName ?? supervisorId;
  const humanRoleParity: HumanRoleParity = { roleId: supervisorId, roleName };

  if (resolved && resolved.activeHolderNames.length === 1) {
    return {
      humanRoleParity,
      approvalInterfaceOwner: {
        scope: "employee",
        label: resolved.activeHolderNames[0],
        roleId: supervisorId,
      },
    };
  }

  return {
    humanRoleParity,
    approvalInterfaceOwner: { scope: "role", label: roleName, roleId: supervisorId },
  };
}

function agentToMember(
  row: AgentRow,
  roles: Map<string, RoleResolution>,
  certification: CoworkerCertificationState | undefined,
): WorkforceMember {
  const unmetNeedCount = row.coworkerNeeds.filter(
    (n) => !RESOLVED_NEED_STATUSES.has(n.status),
  ).length;

  const { humanRoleParity, approvalInterfaceOwner } = resolveParityAndOwner(
    row.humanSupervisorId,
    roles,
  );

  return {
    kind: "agent",
    id: row.agentId,
    // The curated role label, never the raw seed handle: the roster showed
    // "admin-assistant" / "build-specialist" where every other surface says
    // "Platform Admin" / "Build Lead" (BI-005DDC70).
    displayName: row.displayName || row.name,
    status: row.status,
    role: row.valueStream,
    group: row.portfolioId,
    agentNeeds: {
      valueStream: row.valueStream,
      supervisorId: row.humanSupervisorId,
      humanRoleParity,
      approvalInterfaceOwner,
      hitlTier: row.hitlTierDefault,
      lifecycleStage: row.lifecycleStage,
      model: row.executionConfig?.defaultModelId ?? null,
      dailyTokenLimit: row.executionConfig?.dailyTokenLimit ?? null,
      perTaskTokenLimit: row.executionConfig?.perTaskTokenLimit ?? null,
      toolGrantCount: row._count.toolGrants,
      skillCount: row._count.skills,
      unmetNeedCount,
      certification: certification?.status ?? "never",
      certificationAt: certification?.lastRunAt ?? null,
    },
  };
}

/**
 * Resolve the supervising HR roles referenced by the agents into {roleName,
 * activeHolderNames}. Only the roles actually referenced are queried. Degrades to
 * an empty map when the client exposes no platformRole reader (owner stays broad).
 */
async function resolveSupervisingRoles(
  db: WorkforceRosterClient,
  supervisorIds: string[],
): Promise<Map<string, RoleResolution>> {
  const map = new Map<string, RoleResolution>();
  if (supervisorIds.length === 0 || !db.platformRole) return map;

  const rows = (await db.platformRole.findMany({
    where: { roleId: { in: supervisorIds } },
    select: {
      roleId: true,
      name: true,
      users: {
        select: {
          user: {
            select: {
              isActive: true,
              employeeProfile: { select: { displayName: true, status: true } },
            },
          },
        },
      },
    },
  })) as PlatformRoleRow[];

  for (const row of rows) {
    const activeHolderNames = row.users
      .map((u) => u.user)
      .filter((u): u is NonNullable<typeof u> => !!u && u.isActive && !!u.employeeProfile)
      .map((u) => u.employeeProfile!.displayName);
    map.set(row.roleId, { roleName: row.name, activeHolderNames });
  }

  return map;
}

/**
 * Load the unified Workforce roster: human employees + AI coworkers, with the
 * agent-needs lens plus human-role parity + approval/interface owner. Deterministic
 * ordering (humans then agents, each by name).
 */
export async function loadWorkforceRoster(input?: {
  db?: WorkforceRosterClient;
}): Promise<WorkforceRoster> {
  const db = input?.db ?? (prisma as unknown as WorkforceRosterClient);

  const [employees, agentsRaw] = await Promise.all([
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
      // BI-005DDC70: this roster deep-links every coworker to
      // /platform/ai/agent/[agentId], and that route serves ONLY coworkers that
      // pass the selection contract. Loading unfiltered rendered retired /
      // quarantined / draft agents (and dual-seed slug twins) as live rows whose
      // links 404. Same predicate as the AI Workforce roster — one contract.
      where: SELECTABLE_COWORKER_STATE,
      orderBy: { name: "asc" },
      select: {
        agentId: true,
        name: true,
        displayName: true,
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

  // The second half of the selection contract: a canonical AGT-* row whose
  // executable slug twin is not selectable (and a slug twin shown beside its
  // canonical) cannot open its detail record either.
  const agents = dropDualSeedAliasAgents(agentsRaw);

  const supervisorIds = [
    ...new Set(
      agents
        .map((a) => a.humanSupervisorId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const roles = await resolveSupervisingRoles(db, supervisorIds);
  const certificationStates = await loadCertificationStates(
    agents.map((a) => a.agentId),
    db,
  );

  const humanMembers = employees.map(humanToMember);
  const agentMembers = agents.map((a) =>
    agentToMember(a, roles, certificationStates.get(a.agentId)),
  );
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
