import { cron } from "inngest";
import { inngest } from "../inngest-client";

export const issueReportTriage = inngest.createFunction(
  { id: "quality/issue-report-triage", retries: 2, triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const result = await step.run("triage-open-reports", async () => {
      const { prisma } = await import("@dpf/db");
      const { triageIssueReports } = await import("@/lib/operate/issue-report-triage");

      // Try to get a cheap LLM for enhanced triage — local model preferred.
      // Falls back to deterministic logic if no model is available.
      let callLlm: ((messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<{ content: string }>) | undefined;
      try {
        const { routeAndCall } = await import("@/lib/inference/routed-inference");
        callLlm = async (messages, systemPrompt) => {
          const result = await routeAndCall(
            messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            systemPrompt,
            "internal",
            {
              taskType: "triage",
              budgetClass: "minimize_cost",
              effort: "low",
              persistDecision: false,
            },
          );
          return { content: result.content };
        };
      } catch {
        // No models available — proceed with deterministic triage
        console.log("[issue-report-triage] No LLM available, using deterministic triage");
      }

      return triageIssueReports({
        getOpenReports: () =>
          prisma.platformIssueReport.findMany({
            where: { status: "open" },
            orderBy: { createdAt: "asc" },
            take: 100,
            select: {
              id: true,
              reportId: true,
              type: true,
              severity: true,
              title: true,
              description: true,
              routeContext: true,
              errorStack: true,
              source: true,
            },
          }),

        getExistingTitles: async () => {
          const items = await prisma.backlogItem.findMany({
            where: { source: { in: ["issue_report", "process_observer"] } },
            select: { title: true },
          });
          return items.map((i) => i.title);
        },

        createBacklogItem: async (data) => {
          await prisma.backlogItem.create({ data });
        },

        incrementOccurrence: async (title) => {
          const existing = await prisma.backlogItem.findFirst({
            where: {
              title: { contains: title, mode: "insensitive" },
              source: "issue_report",
            },
          });
          if (existing) {
            await prisma.backlogItem.update({
              where: { id: existing.id },
              data: {
                occurrenceCount: { increment: 1 },
                lastSeenAt: new Date(),
              },
            });
          }
        },

        acknowledgeReport: async (id) => {
          await prisma.platformIssueReport.update({
            where: { id },
            data: { status: "acknowledged" },
          });
        },

        resolveTaxonomyNodeByPath: async (path) => {
          // Try exact match first, then endsWith for partial paths
          const node = await prisma.taxonomyNode.findFirst({
            where: {
              OR: [
                { nodeId: path },
                { nodeId: { endsWith: `/${path.split("/").pop()}` } },
              ],
            },
            select: { id: true },
          });
          return node?.id ?? null;
        },

        callLlm,
      });
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
            where: { source: "issue_report", title: { startsWith: "Issue report spike detected" } },
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
