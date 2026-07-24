import { describe, it, expect } from "vitest";

import {
  awaitingVerdict,
  calibrationSet,
  isCalibrationEligible,
  routeCoverage,
  splitForCalibration,
  validateCritiqueEntry,
  type CritiqueEntry,
} from "./critique-entry";

function entry(overrides: Partial<CritiqueEntry> = {}): CritiqueEntry {
  const result = validateCritiqueEntry({
    route: "/workspace",
    finding: "Lead band carries 240 words before the owner's next action appears.",
    screenshotRef: "capture/workspace-390-light.png",
    gitRef: "abc1234",
    verdict: "change-needed",
    verdictAuthority: "founder",
    status: "published",
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture invalid: ${result.error}`);
  return result.entry;
}

describe("validateCritiqueEntry", () => {
  it("rejects an impression instead of an observation", () => {
    const result = validateCritiqueEntry({ route: "/workspace", finding: "feels cluttered" });
    expect(result.ok).toBe(false);
  });

  it("rejects a verdict with no recorded author", () => {
    const result = validateCritiqueEntry({
      route: "/workspace",
      finding: "Lead band carries 240 words before the next action appears.",
      verdict: "change-needed",
    });
    expect(result).toEqual({ ok: false, error: "A verdict must record who attached it." });
  });

  it("defaults a new entry to draft so nothing is born calibration-eligible", () => {
    const result = validateCritiqueEntry({
      route: "/workspace",
      finding: "Lead band carries 240 words before the next action appears.",
    });
    expect(result.ok && result.entry.status).toBe("draft");
  });
});

describe("the authority contract", () => {
  it("accepts a published, founder-verdicted, screenshotted entry", () => {
    expect(isCalibrationEligible(entry())).toBe(true);
  });

  it("counts a no-change-needed verdict — negative entries are calibration data", () => {
    // A corpus of only-problems teaches that every screen has a problem.
    expect(isCalibrationEligible(entry({ verdict: "no-change-needed" }))).toBe(true);
  });

  it("REFUSES an agent-proposed verdict", () => {
    // The load-bearing case. A judge calibrated on agent-authored entries is
    // calibrated against itself and reports rising agreement while measuring
    // nothing.
    expect(isCalibrationEligible(entry({ verdictAuthority: "agent-proposed" }))).toBe(false);
  });

  it("refuses a draft even when it carries a founder verdict", () => {
    expect(isCalibrationEligible(entry({ status: "draft" }))).toBe(false);
  });

  it("refuses an entry with no verdict yet", () => {
    expect(isCalibrationEligible(entry({ verdict: null, verdictAuthority: null }))).toBe(false);
  });

  it("refuses an entry nobody can look at again", () => {
    expect(isCalibrationEligible(entry({ screenshotRef: null }))).toBe(false);
  });

  it("derives the calibration set rather than trusting a curated list", () => {
    const entries = [
      entry(),
      entry({ verdictAuthority: "agent-proposed" }),
      entry({ status: "draft" }),
    ];
    expect(calibrationSet(entries)).toHaveLength(1);
  });
});

describe("awaitingVerdict", () => {
  it("surfaces exactly the entries a founder still has to rule on", () => {
    const needsRuling = entry({ verdict: null, verdictAuthority: null, status: "draft" });
    const proposed = entry({ verdictAuthority: "agent-proposed", status: "draft" });
    const done = entry();
    const queue = awaitingVerdict([needsRuling, proposed, done]);
    expect(queue).toHaveLength(2);
    expect(queue).not.toContain(done);
  });
});

describe("splitForCalibration", () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    entry({ route: `/route-${i}`, finding: `Default view runs to ${300 + i} words on this route.` }),
  );

  it("never lets a held-out entry also ground the judge", () => {
    // The property the whole measurement rests on: held-out must mean
    // never-grounded-in, or agreement is a memory test that passes trivially.
    const { grounding, heldOut } = splitForCalibration(many);
    const groundingKeys = new Set(grounding.map((e) => e.finding));
    for (const held of heldOut) {
      expect(groundingKeys.has(held.finding)).toBe(false);
    }
    expect(grounding.length + heldOut.length).toBe(many.length);
  });

  it("is deterministic across runs", () => {
    const first = splitForCalibration(many).heldOut.map((e) => e.route);
    const second = splitForCalibration(many).heldOut.map((e) => e.route);
    expect(second).toEqual(first);
  });

  it("is stable when unrelated entries are added", () => {
    // Re-splitting on a grown corpus must not reshuffle prior assignments,
    // otherwise yesterday's held-out entry silently becomes grounding.
    const before = new Set(splitForCalibration(many).heldOut.map((e) => e.route));
    const grown = [...many, entry({ route: "/brand-new", finding: "A newly captured finding here." })];
    for (const held of splitForCalibration(grown).heldOut) {
      if (held.route !== "/brand-new") expect(before.has(held.route)).toBe(true);
    }
  });

  it("splits roughly at the requested percentage", () => {
    const { heldOut } = splitForCalibration(many, 30);
    expect(heldOut.length).toBeGreaterThan(many.length * 0.15);
    expect(heldOut.length).toBeLessThan(many.length * 0.45);
  });

  it("only ever splits eligible entries", () => {
    const { grounding, heldOut } = splitForCalibration([
      entry(),
      entry({ route: "/draft-one", status: "draft" }),
    ]);
    expect(grounding.length + heldOut.length).toBe(1);
  });
});

describe("routeCoverage", () => {
  it("counts eligible entries per route, ignoring drafts", () => {
    const coverage = routeCoverage([
      entry({ route: "/workspace" }),
      entry({ route: "/workspace", finding: "Six status lines sit above the primary action." }),
      entry({ route: "/finance", status: "draft" }),
    ]);
    expect(coverage.get("/workspace")).toBe(2);
    expect(coverage.has("/finance")).toBe(false);
  });
});
