// apps/web/app/(shell)/platform/schedule/page.tsx
//
// The operator schedule — "everything the portal is scheduled to do." This is
// the full multi-source calendar: business events PLUS the platform/ops minutia
// (scheduled cron jobs and recurring digests, deployment windows, blackouts,
// change requests, and AI coworker task runs) that were deliberately kept off
// the business workspace home. See
// docs/superpowers/specs/2026-06-06-main-portal-workspace-home-redesign-design.md §6.2.

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { WorkspaceCalendar } from "@/components/workspace/WorkspaceCalendar";
import { getCalendarEvents } from "@/lib/calendar-data";
import { can } from "@/lib/govern/permissions";

export default async function PlatformSchedulePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "view_platform")) redirect("/workspace");

  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), -7);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  const events = await getCalendarEvents(rangeStart, rangeEnd);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Platform schedule</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Everything the portal is scheduled to do — scheduled jobs and recurring digests,
          deployment windows and blackouts, change requests, and AI coworker task runs, alongside
          business events. The business{" "}
          <a href="/workspace/calendar" className="text-[var(--dpf-accent)] hover:underline">
            day-to-day calendar
          </a>{" "}
          hides this platform detail.
        </p>
      </div>

      <PlatformTabNav />

      <WorkspaceCalendar events={events} />
    </div>
  );
}
