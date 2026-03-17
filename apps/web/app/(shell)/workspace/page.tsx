// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWorkspaceTiles } from "@/lib/permissions";
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
  ]);

  // Check for agents with inactive preferred providers
  const inactiveProviderIds = (await prisma.modelProvider.findMany({
    where: { status: "inactive" },
    select: { providerId: true },
  })).map((p) => p.providerId);

  const agentsWithBrokenProviders = inactiveProviderIds.length > 0
    ? await prisma.agent.count({
        where: { preferredProviderId: { in: inactiveProviderIds } },
      })
    : 0;

  // Calendar: fetch events for current month ± 1 week buffer
  const now = new Date();
  const calRangeStart = new Date(now.getFullYear(), now.getMonth(), -7);
  const calRangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  const calendarEvents = await getCalendarEvents(calRangeStart, calRangeEnd);

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
        { label: "Views", value: eaViewCount, color: "#7c8cf8" },
      ],
    },
    ai_workforce: {
      metrics: [
        { label: "Active agents", value: agentCount, color: "#38bdf8" },
        { label: "Providers", value: `${activeProviderCount}/${providerCount}`, color: activeProviderCount > 0 ? "#4ade80" : "#fb923c" },
      ],
      ...(agentsWithBrokenProviders > 0
        ? { badge: `${agentsWithBrokenProviders} agent${agentsWithBrokenProviders !== 1 ? "s" : ""} need attention`, badgeColor: "#fbbf24" }
        : {}),
    },
    build: {
      metrics: [
        { label: "Builds", value: buildCount, color: "#10b981" },
      ],
    },
    portfolio: {
      metrics: [
        { label: "Portfolios", value: portfolioCount, color: "#4ade80" },
        { label: "Products", value: `${activeProductCount} active`, color: "#4ade80" },
      ],
    },
    inventory: {
      metrics: [
        { label: "Products", value: productCount, color: "#fb923c" },
        { label: "Active", value: activeProductCount, color: "#4ade80" },
      ],
    },
    employee: {
      metrics: [
        { label: "Active", value: activeEmployeeCount, color: "#a78bfa" },
        { label: "Total", value: employeeCount, color: "var(--dpf-muted)" },
      ],
    },
    customer: {
      metrics: [
        { label: "Accounts", value: customerAccountCount, color: "#f472b6" },
      ],
    },
    backlog: {
      metrics: [
        { label: "Open", value: openBacklogCount, color: "#38bdf8" },
        { label: "In progress", value: inProgressBacklogCount, color: "#fb923c" },
        { label: "Done", value: doneBacklogCount, color: "#4ade80" },
      ],
      ...(actionableImprovementCount > 0
        ? { badge: `${actionableImprovementCount} improvement${actionableImprovementCount !== 1 ? "s" : ""} pending`, badgeColor: "#a78bfa" }
        : {}),
    },
    platform: {
      metrics: [
        { label: "Users", value: userCount, color: "#fb923c" },
        { label: "Epics", value: epicCount, color: "#38bdf8" },
      ],
    },
    admin: {
      metrics: [
        { label: "Users", value: userCount, color: "#8888a0" },
      ],
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
        <h1 className="text-xl font-bold text-white">
          Welcome, {session.user.platformRole ?? "Guest"}
        </h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {tiles.length} capabilities available
        </p>
      </div>

      <AttentionStrip items={attentionItems} />

      <p className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Your Workspace
      </p>
      <WorkspaceTiles tiles={tiles} tileStatus={tileStatus} />

      {/* Calendar + Activity Feed — side by side */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Calendar
          </p>
          <WorkspaceCalendar events={calendarEvents} />
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
