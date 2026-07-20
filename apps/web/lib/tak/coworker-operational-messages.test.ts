import { describe, expect, it } from "vitest";
import {
  formatIdeateOutcomeMessage,
  formatIncompleteIdeateDesignMessage,
  formatProviderUnavailableMessage,
} from "./coworker-operational-messages";

describe("coworker operational messages", () => {
  it("formats ideate outcome messages with current phase evidence", () => {
    const message = formatIdeateOutcomeMessage({
      approach: "Use the existing Build Studio projection and render the missing operational fields.",
      reviewPassed: true,
      buildId: "FB-1234",
      currentPhase: "plan",
    });

    expect(message).toContain("Status: ready for planning");
    expect(message).toContain("Evidence: design review passed for build FB-1234; current phase is plan.");
    expect(message).toContain("Next action: draft the implementation plan.");
    expect(message).toContain("Owner: Build Studio planning agent");
  });

  it("formats incomplete ideate design messages with an owner", () => {
    const message = formatIncompleteIdeateDesignMessage("FB-5678");

    expect(message).toContain("Status: blocked before planning");
    expect(message).toContain("Evidence: research output for build FB-5678 was missing a usable proposed approach.");
    expect(message).toContain("Owner: Build Studio ideate agent");
  });

  it("formats provider failure messages with concrete operator action", () => {
    const message = formatProviderUnavailableMessage({
      attempts: [{ providerId: "openai", error: "quota exceeded" }],
      inactiveProviders: [],
    });

    expect(message).toContain("Status: blocked");
    expect(message).toContain("Evidence: openai: quota exceeded");
    expect(message).toContain("Next action: restore or switch the configured AI provider");
    expect(message).toContain("Owner: operator/admin");
  });
});
