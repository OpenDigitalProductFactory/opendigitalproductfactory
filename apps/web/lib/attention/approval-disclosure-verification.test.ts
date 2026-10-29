import { describe, expect, it } from "vitest";
import { assertApprovalVerificationRuntime } from "../../scripts/approval-disclosure-verification";

const ci = {
  CI: "true", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40), DPF_APPROVAL_SCENARIO_CI: "1",
  DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf",
  UX_SWEEP_BASE_URL: "http://localhost:3000",
};

describe("approval scenario fixture boundary", () => {
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
