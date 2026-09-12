import { describe, expect, it } from "vitest";

import { CONTRIBUTION_COPY } from "./contribution-copy";

describe("CONTRIBUTION_COPY", () => {
  it("exports token-scope copy for both models", () => {
    expect(CONTRIBUTION_COPY.tokenScope.maintainerDirect).toContain("contents:write");
    // BI-D75B87B1: was `public_repo`, which is the scope a FORK model would
    // need. No shipping path forks, so that scope cannot carry a contribution.
    expect(CONTRIBUTION_COPY.tokenScope.forkPr).toContain("contents:write");
  });

  it("token-scope copy states the write access the shipped path actually needs", () => {
    // BI-D75B87B1 — this test previously asserted the OPPOSITE: that upstream
    // access is NOT required, guarding against admins "over-scoping" tokens.
    // The shipped code writes the branch straight into the target repository
    // (head === base), so upstream write IS required. The old assertion
    // protected a promise the code does not keep, and would have led admins to
    // UNDER-scope a token and have their contribution fail at publish time.
    const copy = CONTRIBUTION_COPY.tokenScope.forkPr.toLowerCase();
    expect(copy).not.toMatch(/not need|does not need|doesn't need/);
    expect(copy).toMatch(/directly into|contents:write/);
    // Must not PROMISE a fork. A denial ("does not create a fork") is correct
    // and must still pass, so match the promise rather than the phrase.
    expect(copy).not.toMatch(/will create a fork|platform will create|creates a fork under/);
  });

  it("pseudonymity copy names the token owner, because there is no fork owner", () => {
    // The exposure is whoever owns the token this install uses. Naming a "fork
    // owner" made the trade-off sound avoidable by picking a different fork
    // target, which is not a choice that exists (BI-D75B87B1).
    expect(CONTRIBUTION_COPY.pseudonymityTradeoff).toMatch(/token owner/i);
    expect(CONTRIBUTION_COPY.pseudonymityTradeoff).not.toMatch(/fork owner/i);
  });

  it("pseudonymity copy keeps the platform-generated identity guidance", () => {
    expect(CONTRIBUTION_COPY.pseudonymityTradeoff).toMatch(/dpf-agent/i);
  });

  it("machine-user opt-in copy covers what the checkbox does", () => {
    expect(CONTRIBUTION_COPY.machineUserOptIn.label).toMatch(/machine-user/i);
    expect(CONTRIBUTION_COPY.machineUserOptIn.description).toMatch(/skip/i);
  });

  it("banner copy covers the needs-configuration path with an action label", () => {
    expect(CONTRIBUTION_COPY.banner.needsConfiguration).toMatch(/re-configuring|configure/i);
    expect(CONTRIBUTION_COPY.banner.openSetupLinkLabel.length).toBeGreaterThan(0);
  });
});
