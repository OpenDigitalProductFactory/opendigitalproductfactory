import { describe, expect, it } from "vitest";
import {
  compareModelProfilePrecedence,
  modelProfileSourceRank,
  pickCapabilityOverrides,
  pickModelProfileSurvivor,
  type ModelProfilePrecedenceCandidate,
} from "./model-profile-precedence";

// BI-84792669 — locks the survivor-selection precedence that the
// collation-drift dedupe (20260720193000) got wrong for
// local/docker.io/ai/qwen3-coder:latest: a `seed` row survived over an
// `evaluated` row, discarding a measured calibration and an admin pin.

function candidate(overrides: Partial<ModelProfilePrecedenceCandidate>): ModelProfilePrecedenceCandidate {
  return {
    id: "id-default",
    profileSource: "seed",
    evalCount: 0,
    toolFidelity: 50,
    lastEvalAt: null,
    generatedAt: null,
    capabilityOverrides: null,
    ...overrides,
  };
}

describe("modelProfileSourceRank", () => {
  it("orders evaluated > admin > catalog > seed", () => {
    expect(modelProfileSourceRank("evaluated")).toBeGreaterThan(modelProfileSourceRank("admin"));
    expect(modelProfileSourceRank("admin")).toBeGreaterThan(modelProfileSourceRank("catalog"));
    expect(modelProfileSourceRank("catalog")).toBeGreaterThan(modelProfileSourceRank("seed"));
  });

  it("ranks unrecognised/null sources alongside catalog", () => {
    expect(modelProfileSourceRank("auto-discover")).toBe(modelProfileSourceRank("catalog"));
    expect(modelProfileSourceRank(null)).toBe(modelProfileSourceRank("catalog"));
    expect(modelProfileSourceRank(undefined)).toBe(modelProfileSourceRank("catalog"));
  });
});

describe("compareModelProfilePrecedence / pickModelProfileSurvivor", () => {
  it("reproduces the qwen3-coder live bug: evaluated beats seed even though seed has a more recent generatedAt", () => {
    const evaluated = candidate({
      id: "cmqem1jz7043601ms0isbs1z1",
      profileSource: "evaluated",
      evalCount: 51,
      toolFidelity: 100,
      lastEvalAt: "2026-07-19T15:05:42.665Z",
      generatedAt: "2026-07-15T03:10:04.445Z",
      capabilityOverrides: { toolUse: true },
    });
    const seed = candidate({
      id: "cmrlkwpqx01968ds4rcvbqxj1",
      profileSource: "seed",
      evalCount: 2,
      toolFidelity: 40,
      lastEvalAt: "2026-07-21T20:51:43.740Z",
      generatedAt: "2026-07-24T03:10:06.199Z",
      capabilityOverrides: null,
    });

    expect(compareModelProfilePrecedence(evaluated, seed)).toBeGreaterThan(0);
    expect(pickModelProfileSurvivor([seed, evaluated])).toBe(evaluated);
    expect(pickModelProfileSurvivor([evaluated, seed])).toBe(evaluated);
  });

  it("admin beats catalog even with a lower evalCount/toolFidelity", () => {
    const admin = candidate({ id: "a", profileSource: "admin", evalCount: 0, toolFidelity: 10 });
    const catalog = candidate({ id: "c", profileSource: "catalog", evalCount: 99, toolFidelity: 99 });
    expect(pickModelProfileSurvivor([catalog, admin])).toBe(admin);
  });

  it("catalog beats seed", () => {
    const catalog = candidate({ id: "c", profileSource: "catalog" });
    const seed = candidate({ id: "s", profileSource: "seed", evalCount: 100, toolFidelity: 100 });
    expect(pickModelProfileSurvivor([seed, catalog])).toBe(catalog);
  });

  it("ties within the same profileSource break on evalCount, then toolFidelity, then lastEvalAt, then generatedAt", () => {
    const base = { id: "base", profileSource: "evaluated" as const };
    const higherEvalCount = candidate({ ...base, id: "hi-count", evalCount: 10, toolFidelity: 50 });
    const lowerEvalCount = candidate({ ...base, id: "lo-count", evalCount: 5, toolFidelity: 90 });
    expect(pickModelProfileSurvivor([lowerEvalCount, higherEvalCount])).toBe(higherEvalCount);

    const higherFidelity = candidate({ ...base, id: "hi-fid", evalCount: 5, toolFidelity: 90 });
    const lowerFidelity = candidate({ ...base, id: "lo-fid", evalCount: 5, toolFidelity: 10, lastEvalAt: "2026-01-01" });
    expect(pickModelProfileSurvivor([lowerFidelity, higherFidelity])).toBe(higherFidelity);

    const recentEval = candidate({ ...base, id: "recent", evalCount: 5, toolFidelity: 50, lastEvalAt: "2026-07-01" });
    const staleEval = candidate({ ...base, id: "stale", evalCount: 5, toolFidelity: 50, lastEvalAt: "2026-01-01" });
    expect(pickModelProfileSurvivor([staleEval, recentEval])).toBe(recentEval);

    const recentGenerated = candidate({ ...base, id: "gen-recent", evalCount: 5, toolFidelity: 50, generatedAt: "2026-07-01" });
    const staleGenerated = candidate({ ...base, id: "gen-stale", evalCount: 5, toolFidelity: 50, generatedAt: "2026-01-01" });
    expect(pickModelProfileSurvivor([staleGenerated, recentGenerated])).toBe(recentGenerated);
  });

  it("treats null lastEvalAt/generatedAt as sorting last (never wins a tie-break over a real timestamp)", () => {
    const withTimestamp = candidate({ id: "with-ts", profileSource: "seed", lastEvalAt: "2020-01-01" });
    const withoutTimestamp = candidate({ id: "without-ts", profileSource: "seed", lastEvalAt: null });
    expect(pickModelProfileSurvivor([withoutTimestamp, withTimestamp])).toBe(withTimestamp);
  });

  it("breaks a true tie deterministically by id ascending", () => {
    const a = candidate({ id: "aaa" });
    const b = candidate({ id: "bbb" });
    expect(compareModelProfilePrecedence(a, b)).toBe(0);
    expect(pickModelProfileSurvivor([b, a])).toBe(a);
  });

  it("throws on an empty candidate list", () => {
    expect(() => pickModelProfileSurvivor([])).toThrow();
  });
});

describe("pickCapabilityOverrides", () => {
  it("keeps the survivor's own overrides when it has one", () => {
    const survivor = candidate({ id: "s", profileSource: "evaluated", capabilityOverrides: { toolUse: true } });
    const loser = candidate({ id: "l", profileSource: "seed", capabilityOverrides: { toolUse: false } });
    expect(pickCapabilityOverrides(survivor, [survivor, loser])).toEqual({ toolUse: true });
  });

  it("copies a loser's non-null overrides onto a survivor that has none (the qwen3-coder bug)", () => {
    const survivor = candidate({ id: "s", profileSource: "evaluated", capabilityOverrides: null });
    const loser = candidate({ id: "l", profileSource: "seed", capabilityOverrides: { toolUse: true } });
    expect(pickCapabilityOverrides(survivor, [survivor, loser])).toEqual({ toolUse: true });
  });

  it("returns null when neither the survivor nor any duplicate has an override", () => {
    const survivor = candidate({ id: "s", capabilityOverrides: null });
    const loser = candidate({ id: "l", capabilityOverrides: null });
    expect(pickCapabilityOverrides(survivor, [survivor, loser])).toBeNull();
  });

  it("when multiple losers carry different pins, picks the pin from the highest-precedence one rather than an arbitrary one", () => {
    const survivor = candidate({ id: "s", profileSource: "evaluated", capabilityOverrides: null });
    const weakerPin = candidate({ id: "w", profileSource: "seed", capabilityOverrides: { toolUse: false } });
    const strongerPin = candidate({ id: "st", profileSource: "admin", capabilityOverrides: { toolUse: true } });
    expect(pickCapabilityOverrides(survivor, [survivor, weakerPin, strongerPin])).toEqual({ toolUse: true });
  });
});
