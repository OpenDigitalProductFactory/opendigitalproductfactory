import { describe, expect, it } from "vitest";

import {
  allFunctions,
  getInngestFunctionsForRuntime,
  scheduledFunctions,
} from "./index";
import { issueReportTriage } from "./issue-report-triage";
import { routeWorkItem } from "./route-work-item";
import { SCHEDULED_JOB_CATALOG } from "@/lib/operate/scheduled-jobs/catalog";

describe("getInngestFunctionsForRuntime", () => {
  it("omits scheduled cron functions unless explicitly enabled", () => {
    const functions = getInngestFunctionsForRuntime({});

    expect(functions).not.toContain(issueReportTriage);
    expect(functions).toContain(routeWorkItem);
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
