import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily A2A collaboration health scan (BI-3003EE63).
 * Runs at 06:25 UTC — after MCP call efficiency (06:15).
 * Analyzes coworker↔coworker edges, notifies, files critical BIs, and
 * dispatches a one-shot platform-engineer review (MCP-efficiency twin).
 */
export const a2aCollaborationHealthScan = inngest.createFunction(
  {
    id: "ops/a2a-collaboration-health-scan",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("25 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/a2a-collaboration-health-scan");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("analyze-notify-and-dispatch-aiops", async () => {
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");
      const { runCollaborationHealthReport } = await import(
        "@/lib/operate/a2a-collaboration-health/report"
      );
      const ownerUserId = await resolveScheduledOwnerUserId();
      const { report, notified, aiOps } = await runCollaborationHealthReport({
        windowHours: 24,
        notify: true,
        dispatchAiOps: true,
        ownerUserId,
      });
      console.log(
        `[a2a-collaboration-health] edges=${report.totalEdges} findings=${report.findings.length} usable=${report.ledgerSufficiency.usable} notified=${notified}` +
          (aiOps
            ? ` aiOps=${aiOps.skipped ? `skip:${aiOps.reason}` : `task=${aiOps.agentTaskId} bis=${aiOps.backlogItemsFiled.length}`}`
            : ""),
      );
      return {
        totalEdges: report.totalEdges,
        findingCount: report.findings.length,
        usable: report.ledgerSufficiency.usable,
        successRate: report.successRate,
        notified,
        aiOps,
        topFindings: report.findings.slice(0, 5).map((f) => ({
          kind: f.kind,
          severity: f.severity,
          title: f.title,
          action: f.recommendedAction,
        })),
      };
    });
  },
);
