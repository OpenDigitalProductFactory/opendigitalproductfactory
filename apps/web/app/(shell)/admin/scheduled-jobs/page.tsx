import { AdminTabNav } from "@/components/admin/AdminTabNav";

import { listScheduledJobsAction } from "@/lib/actions/scheduled-jobs";

import { ScheduledJobsClient } from "./ScheduledJobsClient";

export const dynamic = "force-dynamic";

/**
 * Admin → Advanced → Scheduled Jobs.
 *
 * EP-SCHEDULING-SURFACE (BI-5A42E572 origin) — operational visibility and
 * control over everything the platform runs on a cadence, across both
 * scheduling substrates: code-defined Inngest crons and the proactive AI
 * coworker tasks the agent dispatcher drives.
 *
 * Operator sees clicks only — never CLI — per the never-ask-user-to-run-commands
 * kernel commandment.
 */
export default async function ScheduledJobsAdminPage() {
  const jobs = await listScheduledJobsAction();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Scheduled work</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Coworker tasks and platform crons. Run on demand, or retire what is spent.
        </p>
      </div>

      <AdminTabNav />

      <ScheduledJobsClient initialJobs={jobs} />
    </div>
  );
}
