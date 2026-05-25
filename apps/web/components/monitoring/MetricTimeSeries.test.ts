import { describe, expect, it } from "vitest";

import { normalizeMetricSeries } from "./MetricTimeSeries";

describe("normalizeMetricSeries", () => {
  it("drops non-finite samples so charts render no data instead of NaN labels", () => {
    const series = normalizeMetricSeries(
      [
        {
          metric: { job: "portal" },
          values: [
            [1, "NaN"],
            [2, "+Inf"],
            [3, "-Inf"],
          ],
        },
      ],
      "Latency",
    );

    expect(series).toEqual([]);
  });
});
