import { describe, expect, it } from "vitest";

import {
  LOCAL_UNVERIFIED_CAVEAT,
  applyLocalDegradationCaveat,
  shouldCaveatLocalDegradation,
} from "./local-degradation-caveat";

describe("local-degradation caveat (BI-C0F180E8)", () => {
  const substantive = "The backlog has 21 open PIRs clustered around run_hive_scout_ingest.";

  it("caveats a local answer that used no tools", () => {
    expect(
      shouldCaveatLocalDegradation({ providerId: "local", executedToolCount: 0, content: substantive }),
    ).toBe(true);
    const out = applyLocalDegradationCaveat(substantive, { providerId: "local", executedToolCount: 0 });
    expect(out.startsWith(LOCAL_UNVERIFIED_CAVEAT)).toBe(true);
    expect(out).toContain(substantive);
  });

  it("does NOT caveat a strong paid backup (failover is trustworthy)", () => {
    // The routing-resilience path deliberately keeps a downgraded backup answer;
    // only the weak LOCAL model is untrustworthy.
    expect(
      shouldCaveatLocalDegradation({ providerId: "anthropic", executedToolCount: 0, content: substantive }),
    ).toBe(false);
    expect(applyLocalDegradationCaveat(substantive, { providerId: "anthropic", executedToolCount: 0 })).toBe(
      substantive,
    );
  });

  it("does NOT caveat a local answer that actually used tools", () => {
    expect(
      shouldCaveatLocalDegradation({ providerId: "local", executedToolCount: 3, content: substantive }),
    ).toBe(false);
  });

  it("does NOT call a local answer unverified when the authorized surface was prehydrated", () => {
    expect(
      shouldCaveatLocalDegradation({
        providerId: "local",
        executedToolCount: 0,
        authoritativeSurfaceEvidence: true,
        content: substantive,
      }),
    ).toBe(false);
    expect(
      applyLocalDegradationCaveat(substantive, {
        providerId: "local",
        executedToolCount: 0,
        authoritativeSurfaceEvidence: true,
      }),
    ).toBe(substantive);
  });

  it("does NOT double-caveat an answer that already owns up to running degraded", () => {
    const honest = "This turn ran on the bundled local model, so I couldn't check live data.";
    expect(
      shouldCaveatLocalDegradation({ providerId: "local", executedToolCount: 0, content: honest }),
    ).toBe(false);
    expect(applyLocalDegradationCaveat(honest, { providerId: "local", executedToolCount: 0 })).toBe(honest);
  });

  it("does NOT caveat empty content", () => {
    expect(
      shouldCaveatLocalDegradation({ providerId: "local", executedToolCount: 0, content: "   " }),
    ).toBe(false);
  });
});
