import { describe, expect, it } from "vitest";

import {
  TRIAGE_ACTOR_TYPES,
  TRIAGE_OUTCOMES,
  TRIAGE_QUALITY_ISSUE_TYPES,
} from "./discovery-triage-enums";

describe("discovery triage constants", () => {
  it("uses canonical hyphenated values", () => {
    expect(TRIAGE_OUTCOMES).toContain("auto-attributed");
    expect(TRIAGE_OUTCOMES).toContain("human-review");
    expect(TRIAGE_OUTCOMES).not.toContain("auto_attributed");
    expect(TRIAGE_ACTOR_TYPES).toEqual(["agent", "human", "system"]);
    expect(TRIAGE_QUALITY_ISSUE_TYPES).toEqual([
      "attribution",
      "stale-identity",
      "missing-taxonomy",
    ]);
  });
});
