import { AdminTabNav } from "@/components/admin/AdminTabNav";

import { listScheduledJobsAction } from "@/lib/actions/scheduled-jobs";
import { SCHEDULING_MAP } from "@/lib/operate/scheduled-jobs/scheduling-map";

import { ScheduledJobsClient } from "./ScheduledJobsClient";
import { SchedulingTimeline } from "./SchedulingTimeline";

export const dynamic = "force-dynamic";

/**
 * Admin → Advanced → Scheduled Jobs.
 *
 * BI-5A42E572 / EP-PROACTIVE-OPS. Operational visibility + control for the
 * platform's background schedule — born from a code-graph reconcile cron that
 * sat silently off for 13 days. Lists every scheduled job (code-defined Inngest
 * crons + data-driven ScheduledJob rows), badged core-locked vs editable, with
 * last/next run, health, and operator controls for editable jobs.
 *
 * Operator sees clicks only — never CLI — per the never-ask-user-to-run-commands
 * kernel commandment.
 */
export default async function ScheduledJobsAdminPage() {
  const jobs = await listScheduledJobsAction();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Scheduled Jobs</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Every background job on the platform schedule. Core-locked jobs are
          essential to platform integrity (read-only); editable jobs can be
          retuned, enabled/disabled, or run on demand.
        </p>
      </div>

      <AdminTabNav />

      <SchedulingTimeline entries={SCHEDULING_MAP} />

      <ScheduledJobsClient initialJobs={jobs} />
    </div>
  );
}
