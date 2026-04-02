import { describe, it, expect } from "vitest";
import { checkScenarioAssertions } from "./endpoint-test-registry";
import { mapProbeResultsToInstructionFollowing, mapScoresToCodingCapability } from "./endpoint-test-runner";

describe("checkScenarioAssertions", () => {
  it("passes contains assertion", () => {
    const results = checkScenarioAssertions("Hello world", undefined, [
      { type: "contains", value: "world", description: "test" },
    ]);
    expect(results[0]?.passed).toBe(true);
  });
  it("fails not_contains assertion", () => {
    const results = checkScenarioAssertions("I will now do something", undefined, [
      { type: "not_contains", value: "I will now", description: "test" },
    ]);
    expect(results[0]?.passed).toBe(false);
  });
  it("passes max_length assertion", () => {
    const results = checkScenarioAssertions("Short", undefined, [
      { type: "max_length", value: 100, description: "test" },
    ]);
    expect(results[0]?.passed).toBe(true);
  });
});

describe("mapProbeResultsToInstructionFollowing", () => {
  it("returns excellent when all key probes pass", () => {
    const probes = {
      "tool-calling-basic": true,
      "instruction-compliance-advise-mode": true,
      "no-narration": true,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("excellent");
  });
  it("returns adequate when instruction compliance passes but tool calling fails", () => {
    const probes = {
      "tool-calling-basic": false,
      "instruction-compliance-advise-mode": true,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("adequate");
  });
  it("returns insufficient when instruction compliance fails", () => {
    const probes = {
      "instruction-compliance-advise-mode": false,
    };
    expect(mapProbeResultsToInstructionFollowing(probes)).toBe("insufficient");
  });
});

describe("mapScoresToCodingCapability", () => {
  it("returns excellent for avg >= 4", () => {
    expect(mapScoresToCodingCapability([4, 5, 4])).toBe("excellent");
  });
  it("returns adequate for avg >= 3", () => {
    expect(mapScoresToCodingCapability([3, 3, 4])).toBe("adequate");
  });
  it("returns insufficient for avg < 3", () => {
    expect(mapScoresToCodingCapability([1, 2, 2])).toBe("insufficient");
  });
  it("returns null for empty scores", () => {
    expect(mapScoresToCodingCapability([])).toBeNull();
  });
});
