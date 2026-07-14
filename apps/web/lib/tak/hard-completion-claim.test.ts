import { describe, it, expect } from "vitest";
import { HARD_COMPLETION_CLAIM_PATTERN } from "./agentic-loop";

describe("HARD_COMPLETION_CLAIM_PATTERN CRM create claims (BI-PIR-c4d9de00)", () => {
  it("matches passive prospect/account created claims and ACCT ids", () => {
    expect(
      HARD_COMPLETION_CLAIM_PATTERN.test(
        "Prospect account created for Emma3D (ACCT-17EC9F57).",
      ),
    ).toBe(true);
    expect(HARD_COMPLETION_CLAIM_PATTERN.test("Account created for Acme Corp.")).toBe(true);
    expect(HARD_COMPLETION_CLAIM_PATTERN.test("Reference ACCT-ABCD12")).toBe(true);
  });

  it("still ignores future-intent create wording", () => {
    expect(HARD_COMPLETION_CLAIM_PATTERN.test("I'll create the campaign brief next.")).toBe(false);
  });
});
