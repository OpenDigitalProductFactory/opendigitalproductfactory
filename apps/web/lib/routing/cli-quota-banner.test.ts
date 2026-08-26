import { describe, it, expect } from "vitest";
import { isCliQuotaBanner, stripLeadingQuotaBanner } from "./cli-adapter";

// BI-QUOTA-DEAD-END. Measured on the live install: 23 assistant messages
// carried the CLI's usage-limit banner. 21 were banner-ONLY (a dead end with
// no routing signal, so failover never fired) and 2 had it prepended to a
// genuine answer. The adapter classified auth and overload but had no quota
// branch, so the banner became the reply.
describe("CLI quota banner is recognised", () => {
  const observed = [
    "You've hit your weekly limit · resets 4pm (UTC)",
    "You've hit your weekly limit · resets Aug 18, 4pm (UTC)",
  ];

  it.each(observed)("matches the shape actually observed: %s", (text) => {
    expect(isCliQuotaBanner(text)).toBe(true);
  });

  it("matches the curly apostrophe the CLI may emit", () => {
    expect(isCliQuotaBanner("You’ve hit your weekly limit · resets 4pm (UTC)")).toBe(true);
  });

  it("matches daily and monthly variants", () => {
    expect(isCliQuotaBanner("You've hit your daily limit · resets midnight")).toBe(true);
    expect(isCliQuotaBanner("hit your monthly limit")).toBe(true);
  });

  it("does NOT match ordinary prose about limits", () => {
    // The narrow pattern is the point: "limit" is a common word and a false
    // positive here would discard a real reply as a quota failure.
    expect(isCliQuotaBanner("The weekly limit on ad spend is set per channel.")).toBe(false);
    expect(isCliQuotaBanner("We should limit the weekly report to one page.")).toBe(false);
    expect(isCliQuotaBanner("Rate limits apply to this endpoint.")).toBe(false);
  });
});

describe("a real reply behind the banner survives", () => {
  it("strips a leading banner and keeps the answer", () => {
    // The 2-of-23 case: banner prepended to a genuine reply.
    const text =
      "You've hit your weekly limit · resets 4pm (UTC)\nAUTHORIZED SURFACE DETAILS\n- 0 discovery connections configured; 43 items need review.";
    const out = stripLeadingQuotaBanner(text);

    expect(out).not.toMatch(/hit your weekly limit/);
    expect(out).toContain("AUTHORIZED SURFACE DETAILS");
    expect(out).toContain("43 items need review");
  });

  it("leaves text alone when the banner is not leading", () => {
    // A reply that legitimately discusses usage limits further down must not
    // be truncated.
    const text = "Here is the usage report.\nYou've hit your weekly limit is what the CLI says when quota runs out.";
    expect(stripLeadingQuotaBanner(text)).toBe(text);
  });

  it("leaves ordinary text untouched", () => {
    const text = "Nothing to do here.";
    expect(stripLeadingQuotaBanner(text)).toBe(text);
  });
});
