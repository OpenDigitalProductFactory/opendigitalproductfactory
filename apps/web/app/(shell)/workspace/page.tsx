// apps/web/app/(shell)/workspace/page.tsx
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWorkspaceSections } from "@/lib/permissions";
import { WorkspaceTiles } from "@/components/shell/WorkspaceTiles";
import { AttentionStrip } from "@/components/shell/AttentionStrip";
import { prisma } from "@dpf/db";
import { getCalendarEvents } from "@/lib/calendar-data";
import { WorkspaceCalendar } from "@/components/workspace/WorkspaceCalendar";
import { ActivityFeed } from "@/components/workspace/ActivityFeed";
import { getActivityFeed } from "@/lib/activity-feed-data";
import { BusinessCommandCenter } from "@/components/workspace/BusinessCommandCenter";
import { loadWorkspaceCommandCenter } from "@/lib/workspace/command-center";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const workspaceSections = getWorkspaceSections({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });

  const workspaceCommandCenter = await loadWorkspaceCommandCenter(prisma);

  // Calendar: fetch events for current month +/- 1 week buffer
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Workspace</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Cross-business command center for human employees, AI coworkers, operating cadence, confidence, and containment.
        </p>
      </div>

      <BusinessCommandCenter view={workspaceCommandCenter.commandCenter} />

      <AttentionStrip items={workspaceCommandCenter.attentionItems} />

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
            <WorkspaceTiles tiles={section.tiles} tileStatus={workspaceCommandCenter.tileStatus} />
          </section>
        ))}
      </div>

      {/* Calendar + Activity Feed - side by side */}
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
