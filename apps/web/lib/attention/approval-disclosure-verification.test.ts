import { describe, expect, it } from "vitest";
import { APPROVAL_FIXTURE_WORKROOM_SOURCE, assertApprovalVerificationRuntime, assertApprovalScenarioBudget } from "../../scripts/approval-disclosure-verification";

import { isWorkCapsuleSource } from "../work-capsules";

const ci = {
  CI: "true", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40), DPF_APPROVAL_SCENARIO_CI: "1",
  DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf",
  UX_SWEEP_BASE_URL: "http://localhost:3000",
};

describe("approval scenario fixture boundary", () => {
  it("uses a Workroom source admitted by the canonical database closed set", () => {
    expect(isWorkCapsuleSource(APPROVAL_FIXTURE_WORKROOM_SOURCE)).toBe(true);
  });
  it("accepts the existing explicit GitHub UX measurement runtime", () => {
    expect(assertApprovalVerificationRuntime(ci).origin).toBe("http://localhost:3000");
  });
  it.each([
    { CI: undefined }, { GITHUB_ACTIONS: undefined }, { DPF_APPROVAL_SCENARIO_CI: undefined },
    { GITHUB_RUN_ID: "../other" }, { GITHUB_RUN_ATTEMPT: "../other" }, { GITHUB_SHA: "unbound" },
    { DATABASE_URL: "postgresql://dpf:secret@localhost:5432/dpf" },
    { DATABASE_URL: "postgresql://dpf:ci_test_password@production:5432/dpf" },
    { DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/other" },
    { UX_SWEEP_BASE_URL: "https://production.example" },
    { UX_SWEEP_BASE_URL: "http://localhost:3001" },
    { UX_SWEEP_BASE_URL: "http://localhost:3000/?unbound=true" },
  ])("refuses an undeclared or foreign target before fixture access: %j", (change) => {
    expect(() => assertApprovalVerificationRuntime({ ...ci, ...change })).toThrow();
  });
});


describe("approval scenario acceptance", () => {
  const metrics = { defaultVisibleWords: 400, leadBandWords: 0, primaryActions: 1,
    visibleFields: 0, maxChoicesPerControl: 0, subLegibleControls: 0, buriedPrimaryAction: 0,
    hasLeadBand: false, disclosureRegions: 1, hasNextActionMarker: false, readingGradeLevel: 5 };
  const sample = (overrides = {}) => ({ routePath: "/workspace/inbox", shell: "detail" as const,
    metrics, ariaSnapshot: "actual scenario hierarchy", axeViolations: 2, ...overrides });
  it("accepts a bounded case without adding approval-card accessibility debt", () => {
    expect(() => assertApprovalScenarioBudget(sample(), 0)).not.toThrow();
  });
  it.each([
    { metrics: { ...metrics, defaultVisibleWords: 1000 } },
    { metrics: { ...metrics, primaryActions: 20 } },
    { metrics: { ...metrics, defaultVisibleWords: Number.NaN } },
    { metrics: { ...metrics, subLegibleControls: -1 } },
    { axeViolations: 3 },
  ])("rejects a numeric regression or unavailable measurement: %j", overrides => {
    expect(() => assertApprovalScenarioBudget(sample(overrides), 0)).toThrow();
  });
  it("rejects any serious or critical violation in the approval card", () => {
    expect(() => assertApprovalScenarioBudget(sample(), 1)).toThrow();
  });
});
