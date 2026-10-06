import { describe, expect, it } from "vitest";

import { expectedFires, missedFires } from "./job-engine-soak-report";

describe("job engine soak report: cron fire accounting", () => {
  const from = new Date("2026-10-02T10:00:00Z");
  const to = new Date("2026-10-02T11:00:00Z");

  it("lists every scheduled fire in the window, including one exactly at the start", () => {
    const fires = expectedFires("*/15 * * * *", from, to);
    expect(fires.map((d) => d.toISOString())).toEqual([
      "2026-10-02T10:00:00.000Z",
      "2026-10-02T10:15:00.000Z",
      "2026-10-02T10:30:00.000Z",
      "2026-10-02T10:45:00.000Z",
    ]);
    expect(expectedFires("0 3 * * *", from, to)).toEqual([]);
  });

  it("counts a fire as missed only when nothing landed within the slack", () => {
    const expected = expectedFires("*/15 * * * *", from, to);
    const seen = [new Date("2026-10-02T10:00:00Z"), new Date("2026-10-02T10:16:30Z"), new Date("2026-10-02T10:45:00Z")];
    const missed = missedFires(expected, seen, 5 * 60_000);
    expect(missed.map((d) => d.toISOString())).toEqual(["2026-10-02T10:30:00.000Z"]);
    expect(missedFires(expected, seen, 60_000).map((d) => d.toISOString())).toEqual([
      "2026-10-02T10:15:00.000Z",
      "2026-10-02T10:30:00.000Z",
    ]);
  });
});
