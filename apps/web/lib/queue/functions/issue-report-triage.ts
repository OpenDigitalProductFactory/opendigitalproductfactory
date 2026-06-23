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
  { id: "quality/issue-report-triage", retries: 2, triggers: [cron("3,18,33,48 * * * *")] },
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

    // BI-0ACD9AB2 §14 dial-up: advisory WWMD pre-consult for held escalations, so
    // the /ops attention lens shows the kernel's recommendation without an
    // operator click. Advisory only — it records a recommendation, the human
    // still decides. Best-effort; a failed consult retries on the next sweep.
    const responded = await step.run("respond-to-escalations", async () => {
      try {
        const { runEscalationResponder } = await import("@/lib/quality/escalation-responder-runner");
        return await runEscalationResponder();
      } catch (err) {
        // Advisory feature — never let it fail the core triage cron.
        console.error("[issue-report-triage] escalation responder sweep failed", err);
        return { consulted: 0, failed: 0 };
      }
    });

    console.log(
      `[issue-report-triage] Created ${result.created} backlog items ` +
      `(${result.llmEnhanced} LLM-enhanced), spike=${spiked}, ` +
      `escalations consulted=${responded.consulted}`,
    );

    await step.run("record-job-run", async () => {
      const { recordJobRun } = await import("@/lib/operate/discovery-scheduler");
      await recordJobRun("issue-report-triage", "ok");
    });

    return { ...result, spiked, escalationsConsulted: responded.consulted };
  },
);
