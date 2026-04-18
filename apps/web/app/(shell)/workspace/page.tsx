// apps/web/app/(shell)/workspace/page.tsx
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWorkspaceSections, getWorkspaceTiles } from "@/lib/permissions";
import { WorkspaceTiles } from "@/components/shell/WorkspaceTiles";
import type { TileStatus } from "@/components/shell/WorkspaceTiles";
import { AttentionStrip } from "@/components/shell/AttentionStrip";
import { prisma } from "@dpf/db";
import { getCalendarEvents } from "@/lib/calendar-data";
import { WorkspaceCalendar } from "@/components/workspace/WorkspaceCalendar";
import { ActivityFeed } from "@/components/workspace/ActivityFeed";
import { getActivityFeed } from "@/lib/activity-feed-data";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tiles = getWorkspaceTiles({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });
  const workspaceSections = getWorkspaceSections({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });

  // Fetch all metrics in parallel
  const [
    productCount,
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
  ] = await Promise.all([
    prisma.digitalProduct.count(),
    prisma.digitalProduct.count({ where: { lifecycleStatus: "active" } }),
    prisma.portfolio.count(),
    prisma.agent.count({ where: { status: "active" } }),
    prisma.modelProvider.count(),
    prisma.modelProvider.count({ where: { status: "active" } }),
    prisma.epic.count(),
    prisma.backlogItem.count({ where: { status: "open" } }),
    prisma.backlogItem.count({ where: { status: "in-progress" } }),
    prisma.backlogItem.count({ where: { status: "done" } }),
    prisma.employeeProfile.count(),
    prisma.employeeProfile.count({ where: { status: "active" } }),
    prisma.customerAccount.count(),
    prisma.improvementProposal.count(),
    prisma.improvementProposal.count({ where: { status: { in: ["proposed", "reviewed"] } } }),
    prisma.user.count(),
    prisma.eaView.count(),
    prisma.featureBuild.count(),
    prisma.obligation.count({ where: { status: "active" } }),
    prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
    prisma.control.count({ where: { status: "active" } }),
    prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
    prisma.policy.count({ where: { lifecycleStatus: "published", status: "active" } }),
    prisma.regulatoryAlert.count({ where: { status: "pending" } }),
    // Finance metrics
    prisma.invoice.aggregate({
      where: { status: { in: ["sent", "viewed", "partially_paid", "overdue"] } },
      _sum: { amountDue: true },
      _count: true,
    }),
    prisma.invoice.count({ where: { status: "overdue" } }),
    prisma.bill.count({ where: { status: { in: ["approved", "partially_paid"] } } }),
  ]);

  // EP-AI-WORKFORCE-001: Check for agents with inactive pinned providers via AgentModelConfig
  const inactiveProviderIds = (await prisma.modelProvider.findMany({
    where: { status: "inactive" },
    select: { providerId: true },
  })).map((p) => p.providerId);

  const agentsWithBrokenProviders = inactiveProviderIds.length > 0
    ? await prisma.agentModelConfig.count({
        where: { pinnedProviderId: { in: inactiveProviderIds } },
      })
    : 0;

  // Calendar: fetch events for current month ± 1 week buffer
  const now = new Date();
  const calRangeStart = new Date(now.getFullYear(), now.getMonth(), -7);
  const calRangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  const [calendarEvents, storefrontConfig] = await Promise.all([
    getCalendarEvents(calRangeStart, calRangeEnd),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { category: true } } },
    }).catch(() => null),
  ]);
  const archetypeCategory = storefrontConfig?.archetype?.category ?? null;

  // Activity feed: determine user's employee profile and role context
  const currentUserProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id ?? "" },
    select: { id: true, managerEmployeeId: true },
  }).catch(() => null);
  const hasDirectReports = currentUserProfile
    ? await prisma.employeeProfile.count({ where: { managerEmployeeId: currentUserProfile.id } }) > 0
    : false;
  const isHR = session.user.isSuperuser || session.user.platformRole === "HR-000" || session.user.platformRole === "HR-100";
  const feedItems = await getActivityFeed(currentUserProfile?.id ?? null, hasDirectReports, isHR);

  const tileStatus: Record<string, TileStatus> = {
    ea_modeler: {
      metrics: [
        { label: "Views", value: eaViewCount, color: "var(--dpf-accent)" },
      ],
    },
    ai_workforce: {
      metrics: [
        { label: "Active agents", value: agentCount, color: "var(--dpf-info)" },
        { label: "Providers", value: `${activeProviderCount}/${providerCount}`, color: activeProviderCount > 0 ? "var(--dpf-success)" : "var(--dpf-warning)" },
      ],
      ...(agentsWithBrokenProviders > 0
        ? { badge: `${agentsWithBrokenProviders} agent${agentsWithBrokenProviders !== 1 ? "s" : ""} need attention`, badgeColor: "var(--dpf-warning)" }
        : {}),
    },
    build: {
      metrics: [
        { label: "Builds", value: buildCount, color: "var(--dpf-success)" },
      ],
    },
    portfolio: {
      metrics: [
        { label: "Portfolios", value: portfolioCount, color: "var(--dpf-success)" },
        { label: "Products", value: `${activeProductCount} active`, color: "var(--dpf-success)" },
      ],
    },
    inventory: {
      metrics: [
        { label: "Products", value: productCount, color: "var(--dpf-warning)" },
        { label: "Active", value: activeProductCount, color: "var(--dpf-success)" },
      ],
    },
    employee: {
      metrics: [
        { label: "Active", value: activeEmployeeCount, color: "var(--dpf-info)" },
        { label: "Total", value: employeeCount, color: "var(--dpf-muted)" },
      ],
    },
    customer: {
      metrics: [
        { label: "Accounts", value: customerAccountCount, color: "var(--dpf-accent)" },
      ],
    },
    backlog: {
      metrics: [
        { label: "Open", value: openBacklogCount, color: "var(--dpf-info)" },
        { label: "In progress", value: inProgressBacklogCount, color: "var(--dpf-warning)" },
        { label: "Done", value: doneBacklogCount, color: "var(--dpf-success)" },
      ],
      ...(actionableImprovementCount > 0
        ? { badge: `${actionableImprovementCount} improvement${actionableImprovementCount !== 1 ? "s" : ""} pending`, badgeColor: "var(--dpf-accent)" }
        : {}),
    },
    platform: {
      metrics: [
        { label: "Users", value: userCount, color: "var(--dpf-warning)" },
        { label: "Epics", value: epicCount, color: "var(--dpf-info)" },
      ],
    },
    admin: {
      metrics: [
        { label: "Users", value: userCount, color: "var(--dpf-muted)" },
      ],
    },
    compliance: {
      metrics: [
        { label: "Obligations", value: activeObligationCount, color: "var(--dpf-error)" },
        { label: "Open incidents", value: openIncidentCount, color: openIncidentCount > 0 ? "var(--dpf-warning)" : "var(--dpf-success)" },
        { label: "Controls", value: `${implementedControlCount}/${totalControlCount}`, color: "var(--dpf-info)" },
        { label: "Policies", value: publishedPolicyCount, color: "var(--dpf-accent)" },
      ],
      ...((overdueActionCount > 0 || pendingAlertCount > 0)
        ? {
            badge: [
              overdueActionCount > 0 ? `${overdueActionCount} overdue` : null,
              pendingAlertCount > 0 ? `${pendingAlertCount} alert${pendingAlertCount !== 1 ? "s" : ""}` : null,
            ].filter(Boolean).join(" · "),
            badgeColor: "var(--dpf-warning)",
          }
        : {}),
    },
    finance: {
      metrics: [
        {
          label: "Outstanding",
          value: `${financeOutstanding._count}`,
          color: financeOutstanding._count > 0 ? "var(--dpf-warning)" : "var(--dpf-success)",
        },
        {
          label: "Overdue",
          value: financeOverdueCount,
          color: financeOverdueCount > 0 ? "var(--dpf-error)" : "var(--dpf-success)",
        },
        {
          label: "Bills due",
          value: financeUnpaidBillCount,
          color: financeUnpaidBillCount > 0 ? "var(--dpf-warning)" : "var(--dpf-success)",
        },
      ],
      ...(financeOverdueCount > 0
        ? { badge: `${financeOverdueCount} overdue invoice${financeOverdueCount !== 1 ? "s" : ""}`, badgeColor: "var(--dpf-error)" }
        : {}),
    },
  };

  const attentionItems: Array<{ id: string; label: string; description: string; href: string }> =
    [];

  // Build attention items from real data
  if (actionableImprovementCount > 0) {
    attentionItems.push({
      id: "improvements",
      label: "Improvements",
      description: `${actionableImprovementCount} improvement proposal${actionableImprovementCount !== 1 ? "s" : ""} need review`,
      href: "/ops/improvements",
    });
  }
  if (agentsWithBrokenProviders > 0) {
    attentionItems.push({
      id: "broken-providers",
      label: "AI Workforce",
      description: `${agentsWithBrokenProviders} agent${agentsWithBrokenProviders !== 1 ? "s have" : " has"} an inactive provider — may not work as expected`,
      href: "/platform/ai",
    });
  }
  if (activeProviderCount === 0 && providerCount > 0) {
    attentionItems.push({
      id: "providers",
      label: "AI Providers",
      description: "No active AI providers — agents cannot respond",
      href: "/platform/ai/providers",
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Workspace</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          One human may wear many hats here. Use AI coworkers to fill in specialist expertise while you steer priorities, approvals, and outcomes.
        </p>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            AI-Assisted Operating Model
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">
            Keep the humans on judgment and let AI handle specialist depth
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
            The portal is optimized for a small internal team coordinating a much larger AI workforce, plus external customers, contractors, and fractional staff. Start with the grouped areas below, then let the coworker panel help you bridge domains without memorizing every route.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Today
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--dpf-surface-2)] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">AI coworkers</p>
              <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{agentCount}</p>
            </div>
            <div className="rounded-xl bg-[var(--dpf-surface-2)] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Open work</p>
              <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{openBacklogCount}</p>
            </div>
            <div className="rounded-xl bg-[var(--dpf-surface-2)] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Products</p>
              <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{activeProductCount}</p>
            </div>
            <div className="rounded-xl bg-[var(--dpf-surface-2)] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">External accounts</p>
              <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{customerAccountCount}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--dpf-muted)]">
            {tiles.length} linked areas are available to your current role.
          </p>
        </section>
      </div>

      <AttentionStrip items={attentionItems} />

      <div className="space-y-8">
        {workspaceSections.map((section) => (
          <section key={section.key}>
            <div className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                {section.label}
              </p>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                {section.description}
              </p>
            </div>
            <WorkspaceTiles tiles={section.tiles} tileStatus={tileStatus} />
          </section>
        ))}
      </div>

      {/* Calendar + Activity Feed — side by side */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Calendar
          </p>
          <Suspense fallback={null}>
            <WorkspaceCalendar events={calendarEvents} archetypeCategory={archetypeCategory} />
          </Suspense>
        </div>
        <div>
          <p className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Activity
          </p>
          <ActivityFeed items={feedItems} />
        </div>
      </div>
    </div>
  );
}
