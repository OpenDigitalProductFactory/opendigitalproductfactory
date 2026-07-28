import { describe, expect, it } from "vitest";

import { loadBusinessPerformance } from "./business-performance-provider";

describe("loadBusinessPerformance", () => {
  it("returns an attributed setup state without fabricated metric values", async () => {
    await expect(loadBusinessPerformance()).resolves.toEqual({
      status: "not-configured",
      asOf: null,
      metricValues: [],
      source: "business-performance-read-model",
    });
  });
});
