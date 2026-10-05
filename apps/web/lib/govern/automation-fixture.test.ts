import { describe, expect, it } from "vitest";
import { parseFixtureRequest, fixtureLifetime } from "./automation-fixture";

describe("bounded verification fixture requests", () => {
  it.each([
    { runId: "run", profile: "developer", slot: 0, userId: "someone" },
    { runId: "run", profile: "unknown", slot: 0 },
    { runId: "run", profile: "developer", slot: 2 },
    { runId: "run", profile: "developer", slot: -1 },
    { runId: "run", profile: "developer", slot: 0.5 },
    { runId: "run", profile: "developer", slot: 0, email: "operator@example.test" },
  ])("rejects arbitrary identities and unbounded slots", input => {
    expect(() => parseFixtureRequest(input)).toThrow();
  });
  it("accepts a closed profile and a bounded slot", () => {
    expect(parseFixtureRequest({ runId: "run", profile: "developer", slot: 1 }))
      .toEqual({ runId: "run", profile: "developer", slot: 1 });
  });
  it("caps authority at the original expiry and current lease", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    const original = new Date(now.getTime() + 30_000);
    expect(fixtureLifetime(now, new Date(now.getTime() + 60_000), original)).toEqual(original);
    expect(() => fixtureLifetime(now, now, original)).toThrow();
    expect(fixtureLifetime(now, new Date(now.getTime() + 10 * 3600_000)))
      .toEqual(new Date(now.getTime() + 2 * 3600_000));
  });
});
