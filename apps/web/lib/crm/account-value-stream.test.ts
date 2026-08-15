import { describe, expect, it } from "vitest";
import {
  accountStatusToOvsmStage,
  opportunityStageToOvsmStage,
  ovsmStageLabel,
  CUSTOMER_OVSM_STAGES,
} from "./account-value-stream";
import { CUSTOMER_ACCOUNT_STATUSES } from "@dpf/db/customer-lifecycle";

describe("accountStatusToOvsmStage", () => {
  const cases: Array<[string, string]> = [
    ["prospect", "capture"],
    ["qualified", "qualify"],
    ["onboarding", "deliver"],
    ["active", "retain"],
    ["at_risk", "retain"], // active-stage state
    ["suspended", "retain"],
    ["closed", "retain"],
  ];
  it.each(cases)("maps account status %s → OVSM %s", (status, ovsm) => {
    expect(accountStatusToOvsmStage(status)).toBe(ovsm);
  });

  it("maps every canonical account status to a primary OVSM stage", () => {
    for (const status of CUSTOMER_ACCOUNT_STATUSES) {
      expect(CUSTOMER_OVSM_STAGES).toContain(accountStatusToOvsmStage(status));
    }
  });
});

describe("opportunityStageToOvsmStage", () => {
  it("maps open stages to qualify, won to deliver, lost to capture", () => {
    expect(opportunityStageToOvsmStage("qualification")).toBe("qualify");
    expect(opportunityStageToOvsmStage("negotiation")).toBe("qualify");
    expect(opportunityStageToOvsmStage("closed_won")).toBe("deliver");
    expect(opportunityStageToOvsmStage("closed_lost")).toBe("capture");
  });
});

describe("ovsmStageLabel", () => {
  it("labels the primary stages", () => {
    expect(ovsmStageLabel("retain")).toBe("Retain & Grow");
    expect(ovsmStageLabel("qualify")).toBe("Qualify & Schedule");
  });
});
