import { describe, expect, it } from "vitest";

import { deriveProactivityRoster } from "./proactivity-roster";
import { PROACTIVITY_LEVELS } from "./proactivity-types";

const agents = [
  { agentId: "coo", displayName: "Chief Operating Officer", role: "orchestrator" },
  { agentId: "bookkeeper", displayName: "Bookkeeper", role: "analyst" },
];

describe("deriveProactivityRoster", () => {
  it("uses the owner override level and marks the row as owner-set", () => {
    const rows = deriveProactivityRoster(agents, { bookkeeper: "assertive" });
    const book = rows.find((row) => row.agentId === "bookkeeper");
    expect(book?.isOverride).toBe(true);
    expect(book?.level).toBe("assertive");
  });

  it("falls back to a posture-derived default when there is no override", () => {
    const rows = deriveProactivityRoster(agents, {});
    for (const row of rows) {
      expect(row.isOverride).toBe(false);
      expect(PROACTIVITY_LEVELS).toContain(row.level);
      expect(typeof row.explanation).toBe("string");
    }
  });

  it("preserves each coworker's identity fields in order", () => {
    const rows = deriveProactivityRoster(agents, {});
    expect(rows.map((row) => row.displayName)).toEqual([
      "Chief Operating Officer",
      "Bookkeeper",
    ]);
    expect(rows.map((row) => row.role)).toEqual(["orchestrator", "analyst"]);
  });
});
