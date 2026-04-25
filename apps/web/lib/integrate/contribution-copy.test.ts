import { describe, expect, it } from "vitest";

import { CONTRIBUTION_COPY } from "./contribution-copy";

describe("CONTRIBUTION_COPY", () => {
  it("exports token-scope copy for both models", () => {
    expect(CONTRIBUTION_COPY.tokenScope.maintainerDirect).toContain("contents:write");
    expect(CONTRIBUTION_COPY.tokenScope.forkPr).toContain("public_repo");
  });

  it("token-scope copy for fork-pr explicitly says upstream access is NOT required", () => {
    // The whole point of the fork-pr model — if the copy ever drifts to
    // imply upstream write, admins will over-scope their tokens.
    expect(CONTRIBUTION_COPY.tokenScope.forkPr.toLowerCase()).toMatch(/not need|does not need|doesn't need/);
  });

  it("exports pseudonymity-tradeoff copy that mentions GitHub username visibility", () => {
    expect(CONTRIBUTION_COPY.pseudonymityTradeoff).toMatch(/GitHub username will be visible/i);
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
