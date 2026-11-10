import { describe, expect, it } from "vitest";
import { dailyAllowanceUsedHandoff, describeToolRouteFailure } from "./inference-dead-ends";

// BI-F3B6713F: a used paid AI allowance is a spending limit, not an outage.
describe("daily allowance used", () => {
  it("says the allowance is used, when it resets and who can raise it, instead of pointing at provider settings", () => {
    const error = Object.assign(new Error("Daily allowance used: 206,530 of 200,000 paid tokens for agent \"change-reviewer\" today."),
      { name: "AgentAllowanceExhaustedError", resetAt: "2026-11-04T00:00:00.000Z" });
    const reply = describeToolRouteFailure(error.message, 0, error);
    expect(reply).toBe(dailyAllowanceUsedHandoff("2026-11-04T00:00:00.000Z"));
    expect(reply).toMatch(/resets at 00:00 UTC/);
    expect(reply).toMatch(/Paid AI allowance/);
    expect(reply).not.toMatch(/Providers & Routing|reconnect/i);
  });

  it("recognises the refusal by its message once the type is lost", () => {
    expect(describeToolRouteFailure("Daily allowance used: $25.10 of the $25.00 installation allowance for paid AI today.", 0))
      .toBe(dailyAllowanceUsedHandoff(null));
  });
});
