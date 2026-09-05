import { describe, expect, it } from "vitest";

import {
  allFunctions,
  getInngestFunctionsForRuntime,
  scheduledFunctions,
  eventFunctions,
} from "./index";
import { issueReportTriage } from "./issue-report-triage";
import { routeWorkItem } from "./route-work-item";
import { SCHEDULED_JOB_CATALOG } from "@/lib/operate/scheduled-jobs/catalog";
import { asyncOperationTaskHub } from "./async-operation-task-hub";

describe("getInngestFunctionsForRuntime", () => {
  it("omits scheduled cron functions unless explicitly enabled", () => {
    const functions = getInngestFunctionsForRuntime({});

    expect(functions).not.toContain(issueReportTriage);
    expect(functions).toContain(routeWorkItem);
  });

  it("always registers the async transition projection as an event function only", () => {
    expect(eventFunctions).toContain(asyncOperationTaskHub);
    expect(scheduledFunctions).not.toContain(asyncOperationTaskHub);
    expect(getInngestFunctionsForRuntime({})).toContain(asyncOperationTaskHub);
  });

  it("includes scheduled cron functions when explicitly enabled", () => {
    const functions = getInngestFunctionsForRuntime({
      DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED: "true",
    });

    expect(functions).toEqual(allFunctions);
    expect(functions).toEqual(expect.arrayContaining(scheduledFunctions));
  });
});

describe("scheduled cron <-> catalog parity (drift guard)", () => {
  // The admin Scheduled Jobs surface renders from SCHEDULED_JOB_CATALOG, so a
  // cron in `scheduledFunctions` with no catalog entry runs invisibly — the gap
  // that hid logSignatureScanner / alertDeliveryBridge / releaseHealthCheck.
  // This asserts the two registries agree exactly, in both directions. fn.id()
  // returns the raw Inngest id (e.g. "ops/self-upgrade-scheduled"), which is the
  // value stored as catalog `inngestId`.
  it("describes every scheduled Inngest cron, with no orphan entries", () => {
    const fnIds = scheduledFunctions
      .map((fn) => (fn as { id: () => string }).id())
      .sort();
    const catalogIds = SCHEDULED_JOB_CATALOG.map((e) => e.inngestId).sort();

    const uncatalogued = fnIds.filter((id) => !catalogIds.includes(id));
    const orphaned = catalogIds.filter((id) => !fnIds.includes(id));

    expect(uncatalogued).toEqual([]);
    expect(orphaned).toEqual([]);
  });
});

describe("every-minute cron allowlist (BI-915C40C6)", () => {
  // 1440 runs/day each is the orphan-accumulation multiplier. Only deliberate
  // liveness guards may stay every-minute; everything else must be wider.
  const EVERY_MINUTE = new Set(["* * * * *", "*/1 * * * *"]);
  const ALLOWED_EVERY_MINUTE_INNGEST_IDS = new Set([
    "ops/taskrun-watchdog", // deliberate stall/liveness guard — do not widen
  ]);

  it("catalog has no every-minute cron outside the deliberate allowlist", () => {
    const offenders = SCHEDULED_JOB_CATALOG.filter(
      (e) => EVERY_MINUTE.has(e.cron) && !ALLOWED_EVERY_MINUTE_INNGEST_IDS.has(e.inngestId),
    ).map((e) => e.inngestId);
    expect(offenders).toEqual([]);
  });

  it("keeps the taskrun-watchdog on the every-minute liveness cadence", () => {
    const watchdog = SCHEDULED_JOB_CATALOG.find((e) => e.inngestId === "ops/taskrun-watchdog");
    expect(watchdog?.cron).toBe("* * * * *");
  });
});
