// apps/web/app/(shell)/workspace/calendar/page.tsx
//
// The full BUSINESS calendar — the "open full calendar" target from the
// workspace home's Today & Next agenda. It defaults to business-context
// sources (bookings, money due, providers, CRM, compliance) and hides the
// platform/ops minutia (cron digests, deployment windows, AI task runs), which
// live on the operator schedule at /platform/schedule. All filters remain
// available, so a user can opt the platform sources back in.

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { WorkspaceCalendar } from "@/components/workspace/WorkspaceCalendar";
import { getCalendarEvents } from "@/lib/calendar-data";

export default async function WorkspaceCalendarPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), -7);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  const events = await getCalendarEvents(rangeStart, rangeEnd);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Business calendar</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Bookings, money due, customer deadlines, and team availability. Platform and operations
          schedules live on the{" "}
          <a href="/platform/schedule" className="text-[var(--dpf-accent)] hover:underline">
            platform schedule
          </a>
          .
        </p>
      </div>

      <WorkspaceCalendar
        events={events}
        defaultHiddenCategories={["platform", "operations"]}
        defaultHiddenSources={["scheduled-jobs", "change-mgmt", "agent-tasks"]}
      />
    </div>
  );
}
