import { describe, expect, it } from "vitest";

import { summarizeDiscoveryHealth } from "./discovery-data";

describe("summarizeDiscoveryHealth", () => {
  it("summarizes inventory freshness and unresolved quality issues", () => {
    expect(summarizeDiscoveryHealth({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    })).toEqual({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    });
  });
});
