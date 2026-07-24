import { describe, it, expect } from "vitest";

import {
  CRITIQUE_ENTRY_METADATA_KIND,
  CRITIQUE_SCREENSHOT_ROLE,
  awaitingVerdict,
  calibrationSet,
  critiqueEntryFromWikiPage,
  critiqueEntryToMetadata,
  critiqueScreenshotUrl,
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

describe("metadata round-trip (the storage contract for capture)", () => {
  it("preserves every field through metadata + page reassembly", () => {
    const original = entry();
    const meta = critiqueEntryToMetadata(original);
    // finding and status live on the page, not in metadata, so they must NOT
    // be duplicated into the bag (two copies would drift).
    expect(meta).not.toHaveProperty("finding");
    expect(meta).not.toHaveProperty("status");

    const restored = critiqueEntryFromWikiPage({
      body: original.finding,
      status: original.status,
      metadata: meta,
    });
    expect(restored).toEqual(original);
  });

  it("carries a schema tag so an unknown payload can be refused", () => {
    expect(critiqueEntryToMetadata(entry()).metadataKind).toBe(CRITIQUE_ENTRY_METADATA_KIND);
  });

  it("returns null for a page whose metadata is not a critique entry", () => {
    expect(
      critiqueEntryFromWikiPage({ body: "some other craft note", status: "draft", metadata: null }),
    ).toBeNull();
    expect(
      critiqueEntryFromWikiPage({
        body: "a WSID variant page",
        status: "published",
        metadata: { professionCompetencyLevel: "expert" },
      }),
    ).toBeNull();
  });

  it("takes finding and status from the ROW, not the stale metadata", () => {
    // The page body is the single source of truth for the finding; a later edit
    // to the body must win over whatever the metadata once held.
    const meta = critiqueEntryToMetadata(entry({ status: "draft" }));
    const restored = critiqueEntryFromWikiPage({
      body: "Edited finding: the lead band now runs to 300 words.",
      status: "published",
      metadata: meta,
    });
    expect(restored?.finding).toMatch(/Edited finding/);
    expect(restored?.status).toBe("published");
  });
});

describe("critique screenshot addressing", () => {
  it("builds the session-gated retrieval URL, not the public media path", () => {
    // The whole point of the separate route: a critique of an internal surface
    // must not be servable by the public /api/media capability URL.
    expect(critiqueScreenshotUrl("abc123")).toBe("/api/critique-media/abc123");
    expect(critiqueScreenshotUrl("abc123")).not.toContain("/api/media/");
  });

  it("names a stable attachment role the serve route and action agree on", () => {
    expect(CRITIQUE_SCREENSHOT_ROLE).toBe("critique-screenshot");
  });
});
