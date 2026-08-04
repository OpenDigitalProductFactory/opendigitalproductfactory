import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily A2A collaboration health scan (BI-3003EE63).
 * Runs at 06:25 UTC — after MCP call efficiency (06:15).
 * Slice 1: load edges → pure analyzer → log rollup.
 * Slice 2: PlatformNotification, ImprovementSignal, critical BI, AI Ops handoff.
 */
export const a2aCollaborationHealthScan = inngest.createFunction(
  {
    id: "ops/a2a-collaboration-health-scan",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("25 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("analyze-a2a-collaboration-health", async () => {
      const { runCollaborationHealthReport } = await import(
        "@/lib/operate/a2a-collaboration-health/report"
      );
      const { report, notified } = await runCollaborationHealthReport({
        windowHours: 24,
      });
      console.log(
        `[a2a-collaboration-health] edges=${report.totalEdges} findings=${report.findings.length} usable=${report.ledgerSufficiency.usable} notified=${notified}`,
      );
      return {
        totalEdges: report.totalEdges,
        findingCount: report.findings.length,
        usable: report.ledgerSufficiency.usable,
        successRate: report.successRate,
        notified,
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
