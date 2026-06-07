import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Safety-net sweep + spike detector. Since EP-INTAKE-UNIFY Phase 4, OPEN reports
// are projected into the backlog within seconds of creation by the per-report
// `quality/issue-report.created` event (queue/functions/issue-report-project.ts).
// This 15-minute cron remains the guarantee — it re-projects anything whose
// event was dropped or arrived during quiescence — and is the home of spike
// detection (which needs a historical baseline a single-report event can't see).
// Both paths share runIssueReportTriage(), so they project identically.
export const issueReportTriage = inngest.createFunction(
  { id: "quality/issue-report-triage", retries: 2, triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const result = await step.run("triage-open-reports", async () => {
      const { runIssueReportTriage } = await import("@/lib/operate/issue-report-triage-runner");
      return runIssueReportTriage();
    });

    // Spike detection
    const spiked = await step.run("check-spike", async () => {
      const { prisma } = await import("@dpf/db");
      const { checkForSpike } = await import("@/lib/operate/issue-report-triage");

      return checkForSpike({
        countReportsInWindow: (since) =>
          prisma.platformIssueReport.count({ where: { createdAt: { gte: since } } }),

        countReportsInRange: (from, to) =>
          prisma.platformIssueReport.count({
            where: { createdAt: { gte: from, lt: to } },
          }),

        getExistingTitles: async () => {
          const items = await prisma.backlogItem.findMany({
            where: { workType: "bug", title: { startsWith: "Issue report spike detected" } },
            select: { title: true },
          });
          return items.map((i) => i.title);
        },

        createBacklogItem: async (data) => {
          await prisma.backlogItem.create({ data });
        },
      });
    });

    console.log(
      `[issue-report-triage] Created ${result.created} backlog items ` +
      `(${result.llmEnhanced} LLM-enhanced), spike=${spiked}`,
    );

    await step.run("record-job-run", async () => {
      const { recordJobRun } = await import("@/lib/operate/discovery-scheduler");
      await recordJobRun("issue-report-triage", "ok");
    });

    return { ...result, spiked };
  },
);
