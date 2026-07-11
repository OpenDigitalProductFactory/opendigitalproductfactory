import type { prisma as defaultPrisma } from "@dpf/db";
import type { TileStatus } from "@/components/shell/WorkspaceTiles";
import { resolveApplicableRegulationDbIds } from "@/lib/compliance-library";

export type SixCKey =
  | "context"
  | "connections"
  | "capabilities"
  | "cadence"
  | "confidence"
  | "containment";

export type ReadinessState = "good" | "attention" | "blocked" | "unknown";

export type ReadinessAction = {
  label: string;
  href: string;
};

export type ReadinessCell = {
  key: SixCKey;
  state: ReadinessState;
  label: string;
  /** What this dimension means in general (the column legend). */
  description: string;
  /** Why this cell is in its current state, with the real numbers behind it. */
  reason: string;
  href?: string;
  /** Recommended next step. Present on every non-good cell. */
  action?: ReadinessAction;
};

export type ReadinessAttentionItem = {
  id: string;
  domain: string;
  dimension: string;
  state: Exclude<ReadinessState, "good">;
  reason: string;
  href: string;
  actionLabel?: string;
};

export type ContainmentSignalInput = {
  hasSideEffectAction?: boolean;
  hasApprovalPath?: boolean;
  hasRouteScope?: boolean;
};

export type CommandSeverity = "critical" | "warning" | "info";

export type CommandCenterItem = {
  id: string;
  label: string;
  description: string;
  severity: CommandSeverity;
  href: string;
};

export type BusinessDomainReadiness = {
  id: string;
  label: string;
  href: string;
  cells: ReadinessCell[];
};

export type WorkInMotionItem = {
  id: string;
  label: string;
  actor: string;
  status: string;
  href: string;
};

export type SnapshotItem = {
  id: string;
  label: string;
  value: string | number;
  href: string;
};

export type WorkspaceCommandCenterView = {
  commandStrip: CommandCenterItem[];
  snapshot: SnapshotItem[];
  readiness: BusinessDomainReadiness[];
  workInMotion: WorkInMotionItem[];
};

export type WorkspaceAttentionItem = {
  id: string;
  label: string;
  description: string;
  href: string;
};

export type WorkspaceMetrics = {
  activeProductCount: number;
  portfolioCount: number;
  agentCount: number;
  providerCount: number;
  activeProviderCount: number;
  epicCount: number;
  openBacklogCount: number;
  inProgressBacklogCount: number;
  doneBacklogCount: number;
  employeeCount: number;
  activeEmployeeCount: number;
  customerAccountCount: number;
  improvementCount: number;
  actionableImprovementCount: number;
  userCount: number;
  eaViewCount: number;
  buildCount: number;
  documentCount: number;
  activeObligationCount: number;
  openIncidentCount: number;
  implementedControlCount: number;
  totalControlCount: number;
  overdueActionCount: number;
  publishedPolicyCount: number;
  pendingAlertCount: number;
  financeOutstandingCount: number;
  financeOverdueCount: number;
  financeUnpaidBillCount: number;
};

export type ActiveTaskRunSignal = {
  id: string;
  taskRunId: string;
  title: string;
  status: string;
  source: string;
  actor?: string | null;
  routeContext?: string | null;
};

export type WorkspaceCommandCenterInput = {
  metrics: WorkspaceMetrics;
  agentsWithBrokenProviders: number;
  activeTaskRuns: ActiveTaskRunSignal[];
  activeScheduledTaskCount: number;
  overdueScheduledTaskCount: number;
  blockedTaskRunCount: number;
  recentFailedTaskRunCount: number;
  pendingActionProposalCount: number;
  recentFailedToolExecutionCount: number;
  recentReceiptCount: number;
  openCapabilityNeedCount: number;
  lowConfidenceAssessmentCount: number;
};

export type WorkspaceCommandCenterSummary = {
  commandCenter: WorkspaceCommandCenterView;
  tileStatus: Record<string, TileStatus>;
  attentionItems: WorkspaceAttentionItem[];
};

export type WorkspaceCommandCenterDb = typeof defaultPrisma;

const SIX_C_KEYS: SixCKey[] = [
  "context",
  "connections",
  "capabilities",
  "cadence",
  "confidence",
  "containment",
];

const SIX_C_LABELS: Record<SixCKey, string> = {
  context: "Context",
  connections: "Connections",
  capabilities: "Capabilities",
  cadence: "Cadence",
  confidence: "Confidence",
  containment: "Containment",
};

const SIX_C_DESCRIPTIONS: Record<SixCKey, string> = {
  context: "Evidence, docs, and operating knowledge",
  connections: "Provider, integration, and customer-system links",
  capabilities: "People and AI coworkers able to act",
  cadence: "Scheduled work, reviews, and follow-up rhythm",
  confidence: "Recent receipts and low-risk signals",
  containment: "Approvals, route scope, and side-effect controls",
};

const SIX_C_HREFS: Record<SixCKey, string> = {
  context: "/coworker-decisions",
  connections: "/platform/tools/integrations",
  capabilities: "/platform/ai",
  cadence: "/workspace/my-queue",
  confidence: "/platform/ai/operations-map",
  containment: "/platform/ai/authority",
};

const SEVERITY_RANK: Record<CommandSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

type CellGrade = {
  state: ReadinessState;
  reason: string;
  action?: ReadinessAction;
};

/** "1 invoice" / "2 invoices" — concrete counts inside cell reasons. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function good(reason: string): CellGrade {
  return { state: "good", reason };
}
function attention(reason: string, action?: ReadinessAction): CellGrade {
  return { state: "attention", reason, action };
}
function blocked(reason: string, action?: ReadinessAction): CellGrade {
  return { state: "blocked", reason, action };
}
function unknown(reason: string, action?: ReadinessAction): CellGrade {
  return { state: "unknown", reason, action };
}

const ATTENTION_RANK: Record<Exclude<ReadinessState, "good">, number> = {
  blocked: 0,
  attention: 1,
  unknown: 2,
};

/**
 * Flatten the matrix into an ordered, drill-to-action list of every cell that
 * is not "good" — the at-a-glance "what do I actually do about this" companion
 * to the grid. Blocked first, then attention, then unknown; ties broken by
 * domain name. This is what makes the colored grid mean something.
 */
export function selectReadinessAttention(
  readiness: BusinessDomainReadiness[],
): ReadinessAttentionItem[] {
  const items: ReadinessAttentionItem[] = [];

  for (const row of readiness) {
    for (const cell of row.cells) {
      if (cell.state === "good") continue;
      items.push({
        id: `${row.id}-${cell.key}`,
        domain: row.label,
        dimension: cell.label,
        state: cell.state,
        reason: cell.reason,
        href: cell.action?.href ?? cell.href ?? row.href,
        actionLabel: cell.action?.label,
      });
    }
  }

  return items.sort(
    (a, b) =>
      ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state] ||
      a.domain.localeCompare(b.domain),
  );
}

export function deriveContainmentState(input: ContainmentSignalInput): ReadinessState {
  if (!input.hasSideEffectAction) {
    return input.hasRouteScope === false ? "attention" : "good";
  }

  if (!input.hasApprovalPath || !input.hasRouteScope) {
    return "blocked";
  }

  return "good";
}

export function buildWorkspaceCommandCenterView(
  input: WorkspaceCommandCenterInput,
): WorkspaceCommandCenterView {
  const commandStrip = buildCommandStrip(input);

  return {
    commandStrip,
    snapshot: buildSnapshot(input.metrics),
    readiness: buildReadinessMatrix(input),
    workInMotion: buildWorkInMotion(input),
  };
}

export async function loadWorkspaceCommandCenter(
  prismaClient: WorkspaceCommandCenterDb,
): Promise<WorkspaceCommandCenterSummary> {
  const now = new Date();
  const recentSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Governance readiness counts only the obligations that APPLY to this
  // install's archetype — the wholesale-seeded library would otherwise read
  // as noise on the workspace tiles.
  const applicableRegulationIds = await resolveApplicableRegulationDbIds(prismaClient);

  const [
    activeProductCount,
    portfolioCount,
    agentCount,
    providerCount,
    activeProviderCount,
    epicCount,
    openBacklogCount,
    inProgressBacklogCount,
    doneBacklogCount,
    employeeCount,
    activeEmployeeCount,
    customerAccountCount,
    improvementCount,
    actionableImprovementCount,
    userCount,
    eaViewCount,
    buildCount,
    documentCount,
    activeObligationCount,
    openIncidentCount,
    implementedControlCount,
    totalControlCount,
    overdueActionCount,
    publishedPolicyCount,
    pendingAlertCount,
    financeOutstanding,
    financeOverdueCount,
    financeUnpaidBillCount,
    inactiveProviders,
    activeTaskRuns,
    activeScheduledTaskCount,
    overdueScheduledTaskCount,
    blockedTaskRunCount,
    recentFailedTaskRunCount,
    pendingActionProposalCount,
    recentFailedToolExecutionCount,
    recentReceiptCount,
    openCapabilityNeedCount,
    lowConfidenceAssessmentCount,
  ] = await Promise.all([
    prismaClient.digitalProduct.count({ where: { lifecycleStatus: "active" } }),
    prismaClient.portfolio.count(),
    prismaClient.agent.count({ where: { status: "active" } }),
    prismaClient.modelProvider.count(),
    prismaClient.modelProvider.count({ where: { status: "active" } }),
    prismaClient.epic.count(),
    prismaClient.backlogItem.count({ where: { status: "open" } }),
    prismaClient.backlogItem.count({ where: { status: "in-progress" } }),
    prismaClient.backlogItem.count({ where: { status: "done" } }),
    prismaClient.employeeProfile.count(),
    prismaClient.employeeProfile.count({ where: { status: "active" } }),
    prismaClient.customerAccount.count(),
    prismaClient.improvementProposal.count(),
    prismaClient.improvementProposal.count({ where: { status: { in: ["proposed", "reviewed"] } } }),
    prismaClient.user.count(),
    prismaClient.eaView.count(),
    prismaClient.featureBuild.count(),
    prismaClient.document.count(),
    prismaClient.obligation.count({
      where: { status: "active", regulationId: { in: applicableRegulationIds } },
    }),
    prismaClient.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prismaClient.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
    prismaClient.control.count({ where: { status: "active" } }),
    prismaClient.correctiveAction.count({
      where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: now } },
    }),
    prismaClient.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
    prismaClient.regulatoryAlert.count({ where: { status: "pending" } }),
    prismaClient.invoice.aggregate({
      where: { status: { in: ["sent", "viewed", "partially_paid", "overdue"] } },
      _sum: { amountDue: true },
      _count: true,
    }),
    prismaClient.invoice.count({ where: { status: "overdue" } }),
    prismaClient.bill.count({ where: { status: { in: ["approved", "partially_paid"] } } }),
    prismaClient.modelProvider.findMany({
      where: { status: "inactive" },
      select: { providerId: true },
    }),
    prismaClient.taskRun.findMany({
      where: { status: { in: ["submitted", "working", "input-required", "auth-required"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        taskRunId: true,
        title: true,
        status: true,
        source: true,
        currentAgentId: true,
        routeContext: true,
      },
    }),
    prismaClient.scheduledAgentTask.count({ where: { isActive: true } }),
    prismaClient.scheduledAgentTask.count({
      where: { isActive: true, nextRunAt: { lt: now } },
    }),
    prismaClient.taskRun.count({ where: { status: { in: ["input-required", "auth-required"] } } }),
    prismaClient.taskRun.count({ where: { status: "failed", updatedAt: { gte: recentSince } } }),
    prismaClient.agentActionProposal.count({ where: { status: "proposed" } }),
    prismaClient.toolExecution.count({ where: { success: false, createdAt: { gte: recentSince } } }),
    prismaClient.toolExecutionReceipt.count({
      where: { receiptStatus: "valid", createdAt: { gte: recentSince } },
    }),
    prismaClient.coworkerCapabilityNeed.count({
      where: { status: { in: ["submitted", "reviewing", "accepted"] } },
    }),
    prismaClient.coworkerSelfAssessment.count({
      where: { confidence: "low", supersededAt: null },
    }),
  ]);

  const inactiveProviderIds = inactiveProviders.map((provider) => provider.providerId);
  const agentsWithBrokenProviders = inactiveProviderIds.length > 0
    ? await prismaClient.agentModelConfig.count({
        where: { pinnedProviderId: { in: inactiveProviderIds } },
      })
    : 0;

  const metrics: WorkspaceMetrics = {
    activeProductCount,
    portfolioCount,
    agentCount,
    providerCount,
    activeProviderCount,
    epicCount,
    openBacklogCount,
    inProgressBacklogCount,
    doneBacklogCount,
    employeeCount,
    activeEmployeeCount,
    customerAccountCount,
    improvementCount,
    actionableImprovementCount,
    userCount,
    eaViewCount,
    buildCount,
    documentCount,
    activeObligationCount,
    openIncidentCount,
    implementedControlCount,
    totalControlCount,
    overdueActionCount,
    publishedPolicyCount,
    pendingAlertCount,
    financeOutstandingCount: financeOutstanding._count,
    financeOverdueCount,
    financeUnpaidBillCount,
  };

  const input: WorkspaceCommandCenterInput = {
    metrics,
    agentsWithBrokenProviders,
    activeTaskRuns: activeTaskRuns.map((task) => ({
      id: task.id,
      taskRunId: task.taskRunId,
      title: task.title,
      status: task.status,
      source: task.source,
      actor: task.currentAgentId ?? "AI coworker",
      routeContext: task.routeContext,
    })),
    activeScheduledTaskCount,
    overdueScheduledTaskCount,
    blockedTaskRunCount,
    recentFailedTaskRunCount,
    pendingActionProposalCount,
    recentFailedToolExecutionCount,
    recentReceiptCount,
    openCapabilityNeedCount,
    lowConfidenceAssessmentCount,
  };

  return {
    commandCenter: buildWorkspaceCommandCenterView(input),
    tileStatus: buildWorkspaceTileStatus(metrics, agentsWithBrokenProviders),
    attentionItems: buildAttentionItems(input),
  };
}

function buildCommandStrip(input: WorkspaceCommandCenterInput): CommandCenterItem[] {
  const { metrics } = input;
  const items: CommandCenterItem[] = [];

  if (metrics.financeOverdueCount > 0) {
    items.push({
      id: "finance-overdue",
      label: "Finance exposure",
      description: `${metrics.financeOverdueCount} overdue invoice${metrics.financeOverdueCount !== 1 ? "s" : ""} need attention`,
      severity: "critical",
      href: "/finance",
    });
  }

  if (input.agentsWithBrokenProviders > 0) {
    items.push({
      id: "ai-broken-providers",
      label: "AI workforce containment",
      description: `${input.agentsWithBrokenProviders} coworker${input.agentsWithBrokenProviders !== 1 ? "s have" : " has"} an inactive pinned provider`,
      severity: "critical",
      href: "/platform/ai",
    });
  }

  if (input.recentFailedTaskRunCount > 0 || input.blockedTaskRunCount > 0) {
    items.push({
      id: "ai-run-blockers",
      label: "AI work blocked",
      description: `${input.blockedTaskRunCount + input.recentFailedTaskRunCount} task run${input.blockedTaskRunCount + input.recentFailedTaskRunCount !== 1 ? "s need" : " needs"} review`,
      severity: "critical",
      href: "/platform/ai/operations-map",
    });
  }

  if (metrics.openIncidentCount > 0 || metrics.overdueActionCount > 0 || metrics.pendingAlertCount > 0) {
    items.push({
      id: "compliance-attention",
      label: "Compliance posture",
      description: `${metrics.openIncidentCount} open incident${metrics.openIncidentCount !== 1 ? "s" : ""}, ${metrics.overdueActionCount} overdue action${metrics.overdueActionCount !== 1 ? "s" : ""}`,
      severity: "warning",
      href: "/compliance",
    });
  }

  if (input.pendingActionProposalCount > 0) {
    items.push({
      id: "pending-proposals",
      label: "Containment review",
      description: `${input.pendingActionProposalCount} proposed action${input.pendingActionProposalCount !== 1 ? "s are" : " is"} waiting for a human decision`,
      severity: "warning",
      href: "/platform/ai/authority",
    });
  }

  if (input.overdueScheduledTaskCount > 0) {
    items.push({
      id: "overdue-cadence",
      label: "Cadence drift",
      description: `${input.overdueScheduledTaskCount} scheduled coworker cadence${input.overdueScheduledTaskCount !== 1 ? "s are" : " is"} overdue`,
      severity: "warning",
      href: "/workspace/my-queue",
    });
  }

  if (input.openCapabilityNeedCount > 0) {
    items.push({
      id: "capability-needs",
      label: "Capability investment",
      description: `${input.openCapabilityNeedCount} coworker capability need${input.openCapabilityNeedCount !== 1 ? "s are" : " is"} waiting in review`,
      severity: "info",
      // Capability needs converged into the Backlog (EP-INTAKE-UNIFY); link straight to
      // the /ops origin lens rather than the /platform/ai/capability-needs redirect shim.
      href: "/ops?origin=capability-need",
    });
  }

  if (metrics.actionableImprovementCount > 0) {
    items.push({
      id: "improvements",
      label: "Improvement queue",
      description: `${metrics.actionableImprovementCount} improvement proposal${metrics.actionableImprovementCount !== 1 ? "s need" : " needs"} review`,
      severity: "info",
      href: "/ops/improvements",
    });
  }

  return items.sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return severity !== 0 ? severity : a.label.localeCompare(b.label);
  });
}

function buildSnapshot(metrics: WorkspaceMetrics): SnapshotItem[] {
  return [
    { id: "ai", label: "AI coworkers", value: metrics.agentCount, href: "/platform/ai" },
    {
      id: "work",
      label: "Open work",
      value: metrics.openBacklogCount + metrics.inProgressBacklogCount,
      href: "/ops",
    },
    { id: "customers", label: "Customer accounts", value: metrics.customerAccountCount, href: "/customer" },
    { id: "finance", label: "Finance items", value: metrics.financeOutstandingCount, href: "/finance" },
    { id: "compliance", label: "Open incidents", value: metrics.openIncidentCount, href: "/compliance" },
    { id: "delivery", label: "Builds", value: metrics.buildCount, href: "/build" },
  ];
}

/**
 * Containment for action-capable AI coworkers. Reuses the graded
 * `deriveContainmentState` (good/attention/blocked) and attaches an honest
 * reason + next action to each outcome.
 */
function aiContainmentGrade(input: WorkspaceCommandCenterInput): CellGrade {
  const state = deriveContainmentState({
    hasSideEffectAction: input.metrics.agentCount > 0,
    hasApprovalPath: input.pendingActionProposalCount > 0 || input.recentReceiptCount > 0,
    hasRouteScope: input.metrics.activeProviderCount > 0,
  });

  if (state === "blocked") {
    return blocked("Coworkers can act but an approval path or route scope is missing", {
      label: "Configure authority",
      href: "/platform/ai/authority",
    });
  }
  if (state === "attention") {
    return attention("Route scope is unconfirmed for action-capable coworkers", {
      label: "Review authority",
      href: "/platform/ai/authority",
    });
  }
  return good(
    input.pendingActionProposalCount > 0
      ? `${count(input.pendingActionProposalCount, "action")} awaiting approval — controls active`
      : "Approvals and route scope in place",
  );
}

/**
 * Build the 6x6 domain-readiness matrix. Each (domain x C) cell derives from a
 * DISTINCT real signal, uses the full good/attention/blocked/unknown gradient,
 * and carries a concrete reason plus a recommended next action. Where no real
 * signal exists for a cell, it renders `unknown` honestly rather than a
 * fabricated green.
 */
function buildReadinessMatrix(input: WorkspaceCommandCenterInput): BusinessDomainReadiness[] {
  const m = input.metrics;

  return [
    readinessRow("ai-workforce", "AI workforce", "/platform/ai/operations-map", {
      context:
        m.documentCount > 0 || m.eaViewCount > 0
          ? good(`${count(m.documentCount, "document")}, ${count(m.eaViewCount, "architecture view")}`)
          : attention("No operating documents or architecture views recorded", {
              label: "Add operating knowledge",
              href: "/coworker-decisions",
            }),
      connections:
        m.activeProviderCount === 0
          ? blocked("No active AI provider — coworkers cannot respond", {
              label: "Activate an AI provider",
              href: "/platform/ai/providers",
            })
          : input.agentsWithBrokenProviders > 0
            ? attention(`${count(input.agentsWithBrokenProviders, "coworker")} pinned to an inactive provider`, {
                label: "Review provider pins",
                href: "/platform/ai",
              })
            : good(`${count(m.activeProviderCount, "active provider")}`),
      capabilities:
        m.agentCount === 0
          ? blocked("No AI coworkers configured", { label: "Add an AI coworker", href: "/platform/ai" })
          : good(`${count(m.agentCount, "AI coworker")} able to act`),
      cadence:
        input.overdueScheduledTaskCount > 0
          ? attention(`${count(input.overdueScheduledTaskCount, "scheduled cadence", "scheduled cadences")} overdue`, {
              label: "Clear overdue cadence",
              href: "/workspace/my-queue",
            })
          : input.activeScheduledTaskCount > 0
            ? good(`${count(input.activeScheduledTaskCount, "scheduled cadence", "scheduled cadences")} active`)
            : unknown("No scheduled coworker cadence yet", {
                label: "Schedule recurring work",
                href: "/workspace/my-queue",
              }),
      confidence:
        input.recentReceiptCount === 0
          ? attention("No valid execution receipts in the last 7 days", {
              label: "Review AI operations",
              href: "/platform/ai/operations-map",
            })
          : input.lowConfidenceAssessmentCount > 0
            ? attention(`${count(input.lowConfidenceAssessmentCount, "low-confidence self-assessment")}`, {
                label: "Review coworker capability",
                href: "/platform/ai",
              })
            : input.recentFailedToolExecutionCount > 0
              ? attention(`${count(input.recentFailedToolExecutionCount, "failed tool execution")} in the last 7 days`, {
                  label: "Review failures",
                  href: "/platform/ai/operations-map",
                })
              : good(`${count(input.recentReceiptCount, "valid receipt")} recently, no low-confidence signals`),
      containment: aiContainmentGrade(input),
    }),

    readinessRow("customers-delivery", "Customers and delivery", "/customer", {
      context:
        m.customerAccountCount > 0 || m.buildCount > 0
          ? good(`${count(m.customerAccountCount, "customer account")}, ${count(m.buildCount, "build")}`)
          : attention("No customer accounts or delivery builds yet", { label: "Add a customer", href: "/customer" }),
      connections:
        m.customerAccountCount > 0
          ? good(`${count(m.customerAccountCount, "customer account")} linked`)
          : attention("No customer systems connected", { label: "Connect a customer", href: "/customer" }),
      capabilities:
        m.activeEmployeeCount === 0 && m.agentCount === 0
          ? blocked("No people or coworkers available to deliver", { label: "Add a team member", href: "/employee" })
          : good(`${count(m.activeEmployeeCount, "active team member")}, ${count(m.agentCount, "coworker")}`),
      cadence:
        m.inProgressBacklogCount > 0 || m.buildCount > 0
          ? good(`${count(m.inProgressBacklogCount, "item")} in progress`)
          : unknown("No delivery work in motion", { label: "Plan work", href: "/ops" }),
      confidence:
        input.blockedTaskRunCount > 0 || input.recentFailedTaskRunCount > 0
          ? attention(
              `${count(input.blockedTaskRunCount + input.recentFailedTaskRunCount, "delivery run")} blocked or failed`,
              { label: "Review blocked work", href: "/platform/ai/operations-map" },
            )
          : good("No blocked or failed delivery runs"),
      containment:
        m.userCount === 0
          ? blocked("No platform users — delivery access is not governed", { label: "Add users", href: "/admin" })
          : good(`${count(m.userCount, "governed user")}`),
    }),

    readinessRow("finance", "Finance", "/finance", {
      context:
        m.financeOutstandingCount > 0 || m.financeUnpaidBillCount > 0
          ? good(
              `${count(m.financeOutstandingCount, "outstanding invoice")}, ${count(m.financeUnpaidBillCount, "bill")} due`,
            )
          : attention("No invoices or bills recorded yet", { label: "Set up finance", href: "/finance" }),
      connections:
        m.financeOutstandingCount > 0 || m.financeUnpaidBillCount > 0
          ? good("Finance ledger is active")
          : unknown("No finance activity to confirm connected systems", {
              label: "Connect accounting / payments",
              href: "/platform/tools/integrations",
            }),
      capabilities:
        m.activeEmployeeCount === 0
          ? blocked("No active staff to own finance", { label: "Add finance staff", href: "/employee" })
          : good(`${count(m.activeEmployeeCount, "active team member")}`),
      cadence:
        m.financeOverdueCount > 0
          ? attention(`${count(m.financeOverdueCount, "overdue invoice")}`, {
              label: "Chase overdue invoices",
              href: "/finance",
            })
          : good("No overdue invoices"),
      confidence:
        m.financeUnpaidBillCount > 0
          ? attention(`${count(m.financeUnpaidBillCount, "approved bill")} awaiting payment`, {
              label: "Review payables",
              href: "/finance",
            })
          : good("No payables outstanding"),
      containment:
        m.financeOverdueCount > 0
          ? attention("Overdue receivables are not yet contained", { label: "Review receivables", href: "/finance" })
          : good("Receivables within terms"),
    }),

    readinessRow("compliance", "Compliance", "/compliance", {
      context:
        m.activeObligationCount > 0 || m.publishedPolicyCount > 0
          ? good(
              `${count(m.activeObligationCount, "obligation")}, ${count(m.publishedPolicyCount, "published policy", "published policies")}`,
            )
          : attention("No obligations or published policies", { label: "Set up compliance", href: "/compliance" }),
      connections:
        m.publishedPolicyCount > 0
          ? good(`${count(m.publishedPolicyCount, "published policy", "published policies")}`)
          : attention("No published policies", { label: "Publish a policy", href: "/compliance" }),
      capabilities:
        m.implementedControlCount === 0 && m.agentCount === 0
          ? blocked("No controls or coworkers to act", { label: "Implement controls", href: "/compliance" })
          : good(`${m.implementedControlCount}/${m.totalControlCount} controls implemented`),
      cadence:
        m.overdueActionCount > 0
          ? attention(`${count(m.overdueActionCount, "overdue corrective action")}`, {
              label: "Clear overdue actions",
              href: "/compliance",
            })
          : good("No overdue corrective actions"),
      confidence:
        m.openIncidentCount > 0
          ? attention(`${count(m.openIncidentCount, "open incident")}`, {
              label: "Investigate incidents",
              href: "/compliance",
            })
          : m.pendingAlertCount > 0
            ? attention(`${count(m.pendingAlertCount, "pending regulatory alert")}`, {
                label: "Review alerts",
                href: "/compliance",
              })
            : good("No open incidents or pending alerts"),
      containment:
        m.implementedControlCount === 0
          ? blocked("No implemented controls", { label: "Implement controls", href: "/compliance" })
          : m.openIncidentCount > 0
            ? attention(`${count(m.openIncidentCount, "open incident")} not yet contained`, {
                label: "Contain incidents",
                href: "/compliance",
              })
            : good("Controls implemented, no open incidents"),
    }),

    readinessRow("people", "People", "/employee", {
      context:
        m.employeeCount > 0
          ? good(`${count(m.employeeCount, "employee profile")} on record`)
          : attention("No employee profiles recorded", { label: "Add people", href: "/employee" }),
      connections:
        m.activeEmployeeCount > 0
          ? good(`${count(m.activeEmployeeCount, "active team member")}`)
          : attention("No active team members", { label: "Activate team members", href: "/employee" }),
      capabilities:
        m.activeEmployeeCount === 0
          ? blocked("No active people able to act", { label: "Add active staff", href: "/employee" })
          : good(`${count(m.activeEmployeeCount, "active team member")}`),
      cadence:
        m.activeEmployeeCount > 0 || input.activeScheduledTaskCount > 0
          ? good("Team available for scheduled work")
          : unknown("No people cadence yet", { label: "Add active staff", href: "/employee" }),
      confidence:
        m.employeeCount === 0
          ? unknown("No people data to assess", { label: "Add people", href: "/employee" })
          : m.employeeCount > m.activeEmployeeCount
            ? attention(`${count(m.employeeCount - m.activeEmployeeCount, "inactive profile")}`, {
                label: "Review staff records",
                href: "/employee",
              })
            : good("All employee profiles active"),
      containment:
        m.userCount === 0
          ? blocked("No governed platform users", { label: "Add users", href: "/admin" })
          : good(`${count(m.userCount, "governed user")}`),
    }),

    readinessRow("platform-delivery", "Platform delivery", "/build", {
      context:
        m.buildCount > 0 || m.doneBacklogCount > 0
          ? good(`${count(m.buildCount, "build")}, ${count(m.doneBacklogCount, "item")} delivered`)
          : attention("No builds or delivered work yet", { label: "Start a build", href: "/build" }),
      connections:
        m.activeProviderCount > 0 || m.buildCount > 0
          ? good(`${count(m.activeProviderCount, "active provider")}`)
          : attention("No build providers or activity", {
              label: "Activate a provider",
              href: "/platform/ai/providers",
            }),
      capabilities:
        m.agentCount === 0 && m.activeEmployeeCount === 0
          ? blocked("No coworkers or staff to build", { label: "Add a coworker", href: "/platform/ai" })
          : good(`${count(m.agentCount, "coworker")}, ${count(m.activeEmployeeCount, "active staff member")}`),
      cadence:
        m.inProgressBacklogCount > 0
          ? good(`${count(m.inProgressBacklogCount, "item")} in progress`)
          : input.activeScheduledTaskCount > 0
            ? good(`${count(input.activeScheduledTaskCount, "scheduled cadence", "scheduled cadences")} active`)
            : unknown("No delivery work in motion", { label: "Plan work", href: "/ops" }),
      confidence:
        input.recentFailedToolExecutionCount > 0 || input.recentFailedTaskRunCount > 0
          ? attention(
              `${count(input.recentFailedToolExecutionCount + input.recentFailedTaskRunCount, "failed execution")} in the last 7 days`,
              { label: "Review failures", href: "/platform/ai/operations-map" },
            )
          : good("No recent build or tool failures"),
      containment:
        input.blockedTaskRunCount > 0
          ? blocked(`${count(input.blockedTaskRunCount, "build task")} blocked awaiting input`, {
              label: "Resolve blockers",
              href: "/platform/ai/operations-map",
            })
          : good("Build runs within guardrails"),
    }),
  ];
}

function readinessRow(
  id: string,
  label: string,
  href: string,
  grades: Record<SixCKey, CellGrade>,
): BusinessDomainReadiness {
  return {
    id,
    label,
    href,
    cells: SIX_C_KEYS.map((key) => ({
      key,
      label: SIX_C_LABELS[key],
      description: SIX_C_DESCRIPTIONS[key],
      state: grades[key].state,
      reason: grades[key].reason,
      href: SIX_C_HREFS[key],
      action: grades[key].action,
    })),
  };
}

function buildWorkInMotion(input: WorkspaceCommandCenterInput): WorkInMotionItem[] {
  const activeRuns = input.activeTaskRuns.map((task) => ({
    id: task.id,
    label: task.title,
    actor: task.actor ?? humanizeSource(task.source),
    status: task.status,
    href: "/platform/ai/operations-map",
  }));

  const extraItems: WorkInMotionItem[] = [];

  if (input.pendingActionProposalCount > 0) {
    extraItems.push({
      id: "pending-action-proposals",
      label: `${input.pendingActionProposalCount} proposed action${input.pendingActionProposalCount !== 1 ? "s" : ""} waiting`,
      actor: "Human approver",
      status: "approval-required",
      href: "/platform/ai/authority",
    });
  }

  if (input.activeScheduledTaskCount > 0) {
    extraItems.push({
      id: "scheduled-cadence",
      label: `${input.activeScheduledTaskCount} scheduled coworker cadence${input.activeScheduledTaskCount !== 1 ? "s" : ""} active`,
      actor: "AI workforce",
      status: input.overdueScheduledTaskCount > 0 ? "overdue" : "scheduled",
      href: "/workspace/my-queue",
    });
  }

  const items = [...activeRuns, ...extraItems].slice(0, 6);
  if (items.length > 0) return items;

  return [
    {
      id: "no-active-work",
      label: "No active AI coworker runs",
      actor: "Workspace",
      status: "quiet",
      href: "/platform/ai/operations-map",
    },
  ];
}

function buildAttentionItems(input: WorkspaceCommandCenterInput): WorkspaceAttentionItem[] {
  const items: WorkspaceAttentionItem[] = [];
  const { metrics } = input;

  if (metrics.actionableImprovementCount > 0) {
    items.push({
      id: "improvements",
      label: "Improvements",
      description: `${metrics.actionableImprovementCount} improvement proposal${metrics.actionableImprovementCount !== 1 ? "s" : ""} need review`,
      href: "/ops/improvements",
    });
  }

  if (input.agentsWithBrokenProviders > 0) {
    items.push({
      id: "broken-providers",
      label: "AI Workforce",
      description: `${input.agentsWithBrokenProviders} agent${input.agentsWithBrokenProviders !== 1 ? "s have" : " has"} an inactive provider - may not work as expected`,
      href: "/platform/ai",
    });
  }

  if (metrics.activeProviderCount === 0 && metrics.providerCount > 0) {
    items.push({
      id: "providers",
      label: "AI Providers",
      description: "No active AI providers - agents cannot respond",
      href: "/platform/ai/providers",
    });
  }

  if (input.pendingActionProposalCount > 0) {
    items.push({
      id: "approval-proposals",
      label: "Approvals",
      description: `${input.pendingActionProposalCount} AI coworker proposal${input.pendingActionProposalCount !== 1 ? "s need" : " needs"} a human decision`,
      href: "/platform/ai/authority",
    });
  }

  return items;
}

function buildWorkspaceTileStatus(
  metrics: WorkspaceMetrics,
  agentsWithBrokenProviders: number,
): Record<string, TileStatus> {
  return {
    ea_modeler: {
      metrics: [
        { label: "Views", value: metrics.eaViewCount, color: "var(--dpf-accent)" },
      ],
    },
    ai_workforce: {
      metrics: [
        { label: "Active agents", value: metrics.agentCount, color: "var(--dpf-info)" },
        {
          label: "Providers",
          value: `${metrics.activeProviderCount}/${metrics.providerCount}`,
          color: metrics.activeProviderCount > 0 ? "var(--dpf-success)" : "var(--dpf-warning)",
        },
      ],
      ...(agentsWithBrokenProviders > 0
        ? {
            badge: `${agentsWithBrokenProviders} agent${agentsWithBrokenProviders !== 1 ? "s" : ""} need attention`,
            badgeColor: "var(--dpf-warning)",
          }
        : {}),
    },
    build: {
      metrics: [
        { label: "Builds", value: metrics.buildCount, color: "var(--dpf-success)" },
      ],
    },
    documents: {
      metrics: [
        { label: "Managed", value: metrics.documentCount, color: "var(--dpf-accent)" },
      ],
    },
    portfolio: {
      metrics: [
        { label: "Portfolios", value: metrics.portfolioCount, color: "var(--dpf-success)" },
        { label: "Products", value: `${metrics.activeProductCount} active`, color: "var(--dpf-success)" },
      ],
    },
    employee: {
      metrics: [
        { label: "Active", value: metrics.activeEmployeeCount, color: "var(--dpf-info)" },
        { label: "Total", value: metrics.employeeCount, color: "var(--dpf-muted)" },
      ],
    },
    customer: {
      metrics: [
        { label: "Accounts", value: metrics.customerAccountCount, color: "var(--dpf-accent)" },
      ],
    },
    backlog: {
      metrics: [
        { label: "Open", value: metrics.openBacklogCount, color: "var(--dpf-info)" },
        { label: "In progress", value: metrics.inProgressBacklogCount, color: "var(--dpf-warning)" },
        { label: "Done", value: metrics.doneBacklogCount, color: "var(--dpf-success)" },
      ],
      ...(metrics.actionableImprovementCount > 0
        ? {
            badge: `${metrics.actionableImprovementCount} improvement${metrics.actionableImprovementCount !== 1 ? "s" : ""} pending`,
            badgeColor: "var(--dpf-accent)",
          }
        : {}),
    },
    platform: {
      metrics: [
        { label: "Users", value: metrics.userCount, color: "var(--dpf-warning)" },
        { label: "Epics", value: metrics.epicCount, color: "var(--dpf-info)" },
      ],
    },
    admin: {
      metrics: [
        { label: "Users", value: metrics.userCount, color: "var(--dpf-muted)" },
      ],
    },
    compliance: {
      metrics: [
        { label: "Obligations", value: metrics.activeObligationCount, color: "var(--dpf-error)" },
        {
          label: "Open incidents",
          value: metrics.openIncidentCount,
          color: metrics.openIncidentCount > 0 ? "var(--dpf-warning)" : "var(--dpf-success)",
        },
        {
          label: "Controls",
          value: `${metrics.implementedControlCount}/${metrics.totalControlCount}`,
          color: "var(--dpf-info)",
        },
        { label: "Policies", value: metrics.publishedPolicyCount, color: "var(--dpf-accent)" },
      ],
      ...((metrics.overdueActionCount > 0 || metrics.pendingAlertCount > 0)
        ? {
            badge: [
              metrics.overdueActionCount > 0 ? `${metrics.overdueActionCount} overdue` : null,
              metrics.pendingAlertCount > 0 ? `${metrics.pendingAlertCount} alert${metrics.pendingAlertCount !== 1 ? "s" : ""}` : null,
            ].filter(Boolean).join(" | "),
            badgeColor: "var(--dpf-warning)",
          }
        : {}),
    },
    finance: {
      metrics: [
        {
          label: "Outstanding",
          value: metrics.financeOutstandingCount,
          color: metrics.financeOutstandingCount > 0 ? "var(--dpf-warning)" : "var(--dpf-success)",
        },
        {
          label: "Overdue",
          value: metrics.financeOverdueCount,
          color: metrics.financeOverdueCount > 0 ? "var(--dpf-error)" : "var(--dpf-success)",
        },
        {
          label: "Bills due",
          value: metrics.financeUnpaidBillCount,
          color: metrics.financeUnpaidBillCount > 0 ? "var(--dpf-warning)" : "var(--dpf-success)",
        },
      ],
      ...(metrics.financeOverdueCount > 0
        ? {
            badge: `${metrics.financeOverdueCount} overdue invoice${metrics.financeOverdueCount !== 1 ? "s" : ""}`,
            badgeColor: "var(--dpf-error)",
          }
        : {}),
    },
  };
}

function humanizeSource(source: string): string {
  if (source === "proactive") return "Scheduled coworker";
  if (source === "build") return "Build coworker";
  if (source === "skill") return "Skill runner";
  return "AI coworker";
}
