// apps/web/lib/queue/functions/marketing-scheduler-dispatch.ts
// BI-SCHED-DORMANT / EP-SCHEDULING-SURFACE — wire the marketing scheduler.
//
// The marketing scheduler (ScheduledOutboundAction) already had a complete
// tick/dispatch runner (lib/marketing/scheduler.ts) but no timer: it fired only
// via the manual `tick_marketing_scheduler` MCP tool, so operator-/autopilot-
// scheduled outbound actions never ran on their own — a dormant substrate.
//
// This cron polls due actions on a 30-minute cadence. It only executes
// ScheduledOutboundActions an operator or autopilot policy already created; the
// outbound-send kernel veto still applies to every send; and the job is catalog
// `editable`, so an operator can disable it from /admin/scheduled-jobs.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const marketingSchedulerDispatch = inngest.createFunction(
  { id: "marketing/scheduler-dispatch", retries: 1, triggers: [cron("5,35 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("tick-marketing-scheduler", async () => {
      const { tickScheduler } = await import("@/lib/marketing/scheduler");
      return tickScheduler();
    });
  },
);
