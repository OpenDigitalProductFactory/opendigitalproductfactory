import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// EP-INTAKE-UNIFY Phase 4 / BI-EDFBE081: project a single freshly-created OPEN
// PlatformIssueReport into the backlog within seconds, instead of waiting up to
// 15 minutes for the safety-net cron. Reuses the same runner the cron uses, so
// projection (dedup, occurrence bump, body marker, open→triaged_local) is
// identical. Idempotent: if the report is no longer OPEN (already projected),
// the runner selects nothing and this is a no-op.
export const issueReportProjectOnCreate = inngest.createFunction(
  {
    id: "quality/issue-report-project-on-create",
    retries: 2,
    triggers: [{ event: "quality/issue-report.created" }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, "quality/issue-report-project-on-create");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("project-one-report", async () => {
      const { runIssueReportTriage } = await import("@/lib/operate/issue-report-triage-runner");
      return runIssueReportTriage({ reportId: event.data.reportId });
    });
  },
);
