import type { prisma as defaultPrisma } from "@dpf/db";
import type { TileStatus } from "@/components/shell/WorkspaceTiles";

export type SixCKey =
  | "context"
  | "connections"
  | "capabilities"
  | "cadence"
  | "confidence"
  | "containment";

export type ReadinessState = "good" | "attention" | "blocked" | "unknown";

export type ReadinessSignalInput = {
  hasFreshEvidence?: boolean;
  hasActiveConnection?: boolean;
  hasActor?: boolean;
  hasCadence?: boolean;
  hasContainment?: boolean;
};

export type ReadinessCell = {
  key: SixCKey;
  state: ReadinessState;
  label: string;
  href?: string;
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

const SIX_C_HREFS: Record<SixCKey, string> = {
  context: "/platform/wiki",
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

export function deriveReadinessCell(
  key: SixCKey,
  input: ReadinessSignalInput,
): ReadinessCell {
  let state: ReadinessState;

  switch (key) {
    case "context":
    case "confidence":
      state = input.hasFreshEvidence ? "good" : "attention";
      break;
    case "connections":
      state = input.hasActiveConnection ? "good" : "attention";
      break;
    case "capabilities":
      state = input.hasActor ? "good" : "blocked";
      break;
    case "cadence":
      state = input.hasCadence ? "good" : "unknown";
      break;
    case "containment":
      state = input.hasContainment ? "good" : "blocked";
      break;
  }

  return {
    key,
    label: SIX_C_LABELS[key],
    state,
    href: SIX_C_HREFS[key],
  };
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
    prismaClient.obligation.count({ where: { status: "active" } }),
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
      href: "/platform/ai/capability-needs",
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

function buildReadinessMatrix(input: WorkspaceCommandCenterInput): BusinessDomainReadiness[] {
  const { metrics } = input;

  return [
    readinessRow("ai-workforce", "AI workforce", "/platform/ai/operations-map", {
      hasFreshEvidence: input.recentReceiptCount > 0 && input.lowConfidenceAssessmentCount === 0,
      hasActiveConnection: metrics.activeProviderCount > 0 && input.agentsWithBrokenProviders === 0,
      hasActor: metrics.agentCount > 0,
      hasCadence: input.activeScheduledTaskCount > 0,
      hasContainment: deriveContainmentState({
        hasSideEffectAction: metrics.agentCount > 0,
        hasApprovalPath: input.pendingActionProposalCount > 0 || input.recentReceiptCount > 0,
        hasRouteScope: metrics.activeProviderCount > 0,
      }) !== "blocked",
    }),
    readinessRow("customers-delivery", "Customers and delivery", "/customer", {
      hasFreshEvidence: metrics.customerAccountCount > 0 || metrics.buildCount > 0,
      hasActiveConnection: metrics.customerAccountCount > 0,
      hasActor: metrics.activeEmployeeCount > 0 || metrics.agentCount > 0,
      hasCadence: metrics.inProgressBacklogCount > 0 || metrics.buildCount > 0,
      hasContainment: metrics.userCount > 0,
    }),
    readinessRow("finance", "Finance", "/finance", {
      hasFreshEvidence: metrics.financeOutstandingCount > 0 || metrics.financeUnpaidBillCount > 0,
      hasActiveConnection: true,
      hasActor: metrics.activeEmployeeCount > 0,
      hasCadence: metrics.financeOverdueCount === 0,
      hasContainment: metrics.financeOverdueCount === 0,
    }),
    readinessRow("compliance", "Compliance", "/compliance", {
      hasFreshEvidence: metrics.activeObligationCount > 0 || metrics.publishedPolicyCount > 0,
      hasActiveConnection: metrics.publishedPolicyCount > 0,
      hasActor: metrics.implementedControlCount > 0 || metrics.agentCount > 0,
      hasCadence: metrics.overdueActionCount === 0,
      hasContainment: metrics.implementedControlCount > 0 && metrics.openIncidentCount === 0,
    }),
    readinessRow("people", "People", "/employee", {
      hasFreshEvidence: metrics.employeeCount > 0,
      hasActiveConnection: metrics.activeEmployeeCount > 0,
      hasActor: metrics.activeEmployeeCount > 0,
      hasCadence: input.activeScheduledTaskCount > 0 || metrics.activeEmployeeCount > 0,
      hasContainment: metrics.userCount > 0,
    }),
    readinessRow("platform-delivery", "Platform delivery", "/build", {
      hasFreshEvidence: metrics.buildCount > 0 || metrics.doneBacklogCount > 0,
      hasActiveConnection: metrics.activeProviderCount > 0 || metrics.buildCount > 0,
      hasActor: metrics.agentCount > 0 || metrics.activeEmployeeCount > 0,
      hasCadence: metrics.inProgressBacklogCount > 0 || input.activeScheduledTaskCount > 0,
      hasContainment: input.recentFailedToolExecutionCount === 0,
    }),
  ];
}

function readinessRow(
  id: string,
  label: string,
  href: string,
  signals: ReadinessSignalInput,
): BusinessDomainReadiness {
  return {
    id,
    label,
    href,
    cells: SIX_C_KEYS.map((key) => deriveReadinessCell(key, signals)),
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
