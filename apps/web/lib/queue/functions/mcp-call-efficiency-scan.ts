import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily MCP / governed-tool call efficiency scan (BI-A08EBAEC).
 * Runs at 06:15 UTC — after skill metrics (05:00) and before business hours.
 * Emits PlatformNotification rows for warning/critical thrash, retry storms,
 * and high-volume/failure tools; then closes the loop by filing critical BIs
 * and dispatching a one-shot platform-engineer (AI Ops) review task.
 */
export const mcpCallEfficiencyScan = inngest.createFunction(
  {
    id: "ops/mcp-call-efficiency-scan",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("15 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/mcp-call-efficiency-scan");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("analyze-notify-and-dispatch-aiops", async () => {
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");
      const { runCallEfficiencyReport } = await import(
        "@/lib/operate/mcp-call-efficiency/report"
      );
      const ownerUserId = await resolveScheduledOwnerUserId();
      const { report, notified, aiOps } = await runCallEfficiencyReport({
        windowHours: 24,
        notify: true,
        dispatchAiOps: true,
        ownerUserId,
      });
      console.log(
        `[mcp-call-efficiency] calls=${report.totalCalls} findings=${report.findings.length} notified=${notified} usable=${report.ledgerSufficiency.usable}` +
          (aiOps
            ? ` aiOps=${aiOps.skipped ? `skip:${aiOps.reason}` : `task=${aiOps.agentTaskId} bis=${aiOps.backlogItemsFiled.length}`}`
            : ""),
      );
      return {
        totalCalls: report.totalCalls,
        findingCount: report.findings.length,
        notified,
        aiOps,
        topFindings: report.findings.slice(0, 5).map((f) => ({
          kind: f.kind,
          toolName: f.toolName,
          severity: f.severity,
          action: f.recommendedAction,
        })),
      };
    });
  },
);
