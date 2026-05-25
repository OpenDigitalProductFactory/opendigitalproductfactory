import { describe, expect, it } from "vitest";

import {
  allFunctions,
  getInngestFunctionsForRuntime,
  scheduledFunctions,
} from "./index";
import { issueReportTriage } from "./issue-report-triage";
import { routeWorkItem } from "./route-work-item";

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
