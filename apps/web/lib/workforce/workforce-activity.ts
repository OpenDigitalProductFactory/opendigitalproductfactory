// Workforce ACTIVITY projection (BI-D80A1C3E).
//
// The /employee surface historically answered only "who exists" — an HR roster
// of role definitions and sparse employee records. This module adds the missing
// half: "what is the workforce DOING for customers/business outcomes" and "what
// needs the operator right now".
//
// It composes three signals into one workforce-at-work view:
//   1. Active work the workforce owns — in-flight FeatureBuilds (the AI + human
//      workforce's live customer/business work), with their owner and phase.
//   2. Items needing the operator — a derived concern list: unassigned roles
//      that carry an SLA, builds awaiting human approval, and phase handoffs
//      that left open issues.
//
// The "needs-operator" classification lives in a PURE, testable function
// (deriveWorkforceConcerns) so ordering/severity can be unit-tested without a DB.
// The loader (loadWorkforceActivity) only maps Prisma rows into that pure input.

import { prisma } from "@dpf/db";

// ---------------------------------------------------------------------------
// Active work (what the workforce is actively working on)
// ---------------------------------------------------------------------------

/** One live piece of customer/business work the workforce owns. */
export type WorkforceActiveWorkItem = {
  /** FeatureBuild.buildId. */
  buildId: string;
  title: string;
  /** feature | fix. */
  kind: string;
  /** Current build phase (ideate | plan | build | review | ship). */
  phase: string;
  /** Human-readable owner: the accountable employee or claiming agent. */
  ownerLabel: string;
  /** "agent" | "human" | "unassigned" — who is driving the work. */
  ownerKind: "agent" | "human" | "unassigned";
  /** Last activity timestamp (ISO), for recency ordering in the UI. */
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Needs-operator concerns (pure derivation)
// ---------------------------------------------------------------------------

export type WorkforceConcernKind =
  | "unassigned-role-sla"
  | "pending-approval"
  | "pending-handoff";

export type WorkforceConcernSeverity = "high" | "medium" | "low";

/** A single item that needs the operator's attention. */
export type WorkforceConcern = {
  kind: WorkforceConcernKind;
  /** Stable id for React keys / linking (roleId or buildId scoped by kind). */
  id: string;
  /** Short operator-facing headline. */
  title: string;
  /** One-line supporting detail. */
  detail: string;
  severity: WorkforceConcernSeverity;
  /** SLA window in hours when the concern carries one; null otherwise. */
  slaHours: number | null;
};

/** A role definition with its SLA and current assignment count. */
export type RoleAssignmentInput = {
  roleId: string;
  name: string;
  /** SLA window in hours. 0 or null = no SLA. */
  slaHours: number | null;
  /** How many people currently hold this role. */
  assignedCount: number;
};

/** A build awaiting a human approval/disposition gate. */
export type PendingApprovalInput = {
  buildId: string;
  title: string;
  /** Phase the build is gated at (e.g. "review", "ship"). */
  phase: string;
  ownerLabel: string;
};

/** A phase handoff that left open issues for the operator. */
export type PendingHandoffInput = {
  buildId: string;
  title: string;
  fromPhase: string;
  toPhase: string;
  openIssueCount: number;
};

export type WorkforceActivityInput = {
  roles: RoleAssignmentInput[];
  pendingApprovals: PendingApprovalInput[];
  pendingHandoffs: PendingHandoffInput[];
};

const SEVERITY_RANK: Record<WorkforceConcernSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Severity for an unassigned role with an SLA: the tighter the SLA the more
 * urgent the coverage gap (e.g. a 4h SLA role with nobody assigned is a high
 * concern; a 72h SLA role is low).
 */
export function severityForUnassignedSla(slaHours: number): WorkforceConcernSeverity {
  if (slaHours <= 4) return "high";
  if (slaHours <= 24) return "medium";
  return "low";
}

/**
 * Derive the ordered "needs operator" concern list from workforce state.
 *
 * PURE — no DB, no clock, no I/O. Deterministic ordering:
 *   1. severity (high → medium → low)
 *   2. tighter SLA first (null SLA sorts after any real SLA)
 *   3. concern kind (stable tie-break)
 *   4. id (fully stable tie-break)
 */
export function deriveWorkforceConcerns(input: WorkforceActivityInput): WorkforceConcern[] {
  const concerns: WorkforceConcern[] = [];

  // Unassigned roles that carry an SLA — the operator must staff (or reassign)
  // them or the SLA is unowned. Roles with no SLA or with people assigned are
  // not surfaced as concerns.
  for (const role of input.roles) {
    const sla = role.slaHours ?? 0;
    if (sla <= 0) continue;
    if (role.assignedCount > 0) continue;
    concerns.push({
      kind: "unassigned-role-sla",
      id: `role:${role.roleId}`,
      title: `${role.name} unassigned`,
      detail: `No one holds this ${sla}h-SLA role — the SLA is unowned.`,
      severity: severityForUnassignedSla(sla),
      slaHours: sla,
    });
  }

  // Builds waiting on a human approval gate — the operator has to act for the
  // work to advance.
  for (const approval of input.pendingApprovals) {
    concerns.push({
      kind: "pending-approval",
      id: `approval:${approval.buildId}`,
      title: `Approve ${approval.title}`,
      detail: `Build is at the ${approval.phase} gate, awaiting your approval (${approval.ownerLabel}).`,
      severity: "medium",
      slaHours: null,
    });
  }

  // Phase handoffs that carried open issues forward — a human should look at
  // them before they compound.
  for (const handoff of input.pendingHandoffs) {
    if (handoff.openIssueCount <= 0) continue;
    concerns.push({
      kind: "pending-handoff",
      id: `handoff:${handoff.buildId}`,
      title: `Handoff with open issues: ${handoff.title}`,
      detail: `${handoff.openIssueCount} open issue${
        handoff.openIssueCount === 1 ? "" : "s"
      } handed from ${handoff.fromPhase} → ${handoff.toPhase}.`,
      severity: "medium",
      slaHours: null,
    });
  }

  return concerns.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const aSla = a.slaHours ?? Number.POSITIVE_INFINITY;
    const bSla = b.slaHours ?? Number.POSITIVE_INFINITY;
    if (aSla !== bSla) return aSla - bSla;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Assembled activity view
// ---------------------------------------------------------------------------

export type WorkforceActivitySummary = {
  /** In-flight work items the workforce owns. */
  activeWorkCount: number;
  /** Active items driven by an AI agent. */
  agentDriven: number;
  /** Active items driven by a human. */
  humanDriven: number;
  /** Total needs-operator concerns. */
  concernCount: number;
  /** High-severity concern count (the "act now" number). */
  highSeverity: number;
};

export type WorkforceActivity = {
  activeWork: WorkforceActiveWorkItem[];
  concerns: WorkforceConcern[];
  summary: WorkforceActivitySummary;
};

/** Build phases that are still in-flight (not terminal). */
const ACTIVE_BUILD_PHASES = new Set(["ideate", "plan", "build", "review", "ship"]);
/** Phases gated on a human approval/disposition. */
const APPROVAL_GATE_PHASES = new Set(["review", "ship"]);

/** Structural DB client — satisfied by the real PrismaClient and by test fakes. */
export type WorkforceActivityClient = {
  platformRole: { findMany: (args: unknown) => Promise<unknown> };
  featureBuild: { findMany: (args: unknown) => Promise<unknown> };
  phaseHandoff: { findMany: (args: unknown) => Promise<unknown> };
};

type RoleRow = {
  roleId: string;
  name: string;
  slaDurationH: number | null;
  _count: { users: number };
};

type BuildRow = {
  buildId: string;
  title: string;
  kind: string | null;
  phase: string;
  updatedAt: Date;
  claimedByAgentId: string | null;
  accountableEmployee: { displayName: string } | null;
};

type HandoffRow = {
  buildId: string;
  fromPhase: string;
  toPhase: string;
  openIssues: string[];
  build: { title: string } | null;
};

function ownerFor(build: BuildRow): { label: string; kind: WorkforceActiveWorkItem["ownerKind"] } {
  if (build.accountableEmployee?.displayName) {
    return { label: build.accountableEmployee.displayName, kind: "human" };
  }
  if (build.claimedByAgentId) {
    return { label: build.claimedByAgentId, kind: "agent" };
  }
  return { label: "Unassigned", kind: "unassigned" };
}

/**
 * Load the workforce-activity view: active work the workforce owns + the derived
 * needs-operator concern list, composed with role/SLA and handoff state.
 */
export async function loadWorkforceActivity(input?: {
  db?: WorkforceActivityClient;
}): Promise<WorkforceActivity> {
  const db = input?.db ?? (prisma as unknown as WorkforceActivityClient);

  const [roles, builds, handoffs] = await Promise.all([
    db.platformRole.findMany({
      orderBy: { roleId: "asc" },
      select: {
        roleId: true,
        name: true,
        slaDurationH: true,
        _count: { select: { users: true } },
      },
    }) as Promise<RoleRow[]>,
    db.featureBuild.findMany({
      where: { phase: { in: [...ACTIVE_BUILD_PHASES] }, abandonedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        buildId: true,
        title: true,
        kind: true,
        phase: true,
        updatedAt: true,
        claimedByAgentId: true,
        accountableEmployee: { select: { displayName: true } },
      },
    }) as Promise<BuildRow[]>,
    db.phaseHandoff.findMany({
      where: { build: { phase: { in: [...ACTIVE_BUILD_PHASES] }, abandonedAt: null } },
      orderBy: { createdAt: "desc" },
      select: {
        buildId: true,
        fromPhase: true,
        toPhase: true,
        openIssues: true,
        build: { select: { title: true } },
      },
    }) as Promise<HandoffRow[]>,
  ]);

  const activeWork: WorkforceActiveWorkItem[] = builds.map((b) => {
    const owner = ownerFor(b);
    return {
      buildId: b.buildId,
      title: b.title,
      kind: b.kind ?? "feature",
      phase: b.phase,
      ownerLabel: owner.label,
      ownerKind: owner.kind,
      updatedAt: b.updatedAt.toISOString(),
    };
  });

  const pendingApprovals: PendingApprovalInput[] = builds
    .filter((b) => APPROVAL_GATE_PHASES.has(b.phase))
    .map((b) => ({
      buildId: b.buildId,
      title: b.title,
      phase: b.phase,
      ownerLabel: ownerFor(b).label,
    }));

  // Only the latest handoff per build carries a live "open issues" signal —
  // handoffs are ordered newest-first, so keep the first seen per buildId.
  const seenHandoff = new Set<string>();
  const pendingHandoffs: PendingHandoffInput[] = [];
  for (const h of handoffs) {
    if (seenHandoff.has(h.buildId)) continue;
    seenHandoff.add(h.buildId);
    if (h.openIssues.length === 0) continue;
    pendingHandoffs.push({
      buildId: h.buildId,
      title: h.build?.title ?? h.buildId,
      fromPhase: h.fromPhase,
      toPhase: h.toPhase,
      openIssueCount: h.openIssues.length,
    });
  }

  const concerns = deriveWorkforceConcerns({
    roles: roles.map((r) => ({
      roleId: r.roleId,
      name: r.name,
      slaHours: r.slaDurationH,
      assignedCount: r._count.users,
    })),
    pendingApprovals,
    pendingHandoffs,
  });

  return {
    activeWork,
    concerns,
    summary: {
      activeWorkCount: activeWork.length,
      agentDriven: activeWork.filter((w) => w.ownerKind === "agent").length,
      humanDriven: activeWork.filter((w) => w.ownerKind === "human").length,
      concernCount: concerns.length,
      highSeverity: concerns.filter((c) => c.severity === "high").length,
    },
  };
}
