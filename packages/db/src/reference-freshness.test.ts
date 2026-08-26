import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  MAX_REFERENCE_STALE_DAYS,
  clampStaleAfterDays,
  describeReferenceFreshness,
  referenceFreshness,
} from "./reference-freshness";

const NOW = new Date("2026-08-25T00:00:00.000Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("clampStaleAfterDays", () => {
  it("holds the ceiling at 90 days", () => {
    expect(MAX_REFERENCE_STALE_DAYS).toBe(90);
  });

  it("clamps a longer budget down to the ceiling", () => {
    expect(clampStaleAfterDays(120)).toBe(90);
    expect(clampStaleAfterDays(180)).toBe(90);
  });

  it("leaves a shorter budget alone — a faster-moving authority may be re-checked sooner", () => {
    expect(clampStaleAfterDays(30)).toBe(30);
  });

  it("falls back to the ceiling for a nonsense budget rather than trusting it", () => {
    expect(clampStaleAfterDays(0)).toBe(90);
    expect(clampStaleAfterDays(-5)).toBe(90);
    expect(clampStaleAfterDays(Number.NaN)).toBe(90);
  });
});

describe("referenceFreshness", () => {
  it("reports a recently confirmed row as fresh", () => {
    const result = referenceFreshness(
      { lastVerifiedAt: daysBefore(10), staleAfterDays: 90 },
      NOW,
    );
    expect(result.state).toBe("fresh");
    expect(result.ageDays).toBe(10);
    expect(result.requiresReverification).toBe(false);
  });

  it("reports a row past its budget as stale", () => {
    const result = referenceFreshness(
      { lastVerifiedAt: daysBefore(91), staleAfterDays: 90 },
      NOW,
    );
    expect(result.state).toBe("stale");
    expect(result.requiresReverification).toBe(true);
  });

  it("goes stale on the boundary day, not the day after", () => {
    expect(referenceFreshness({ lastVerifiedAt: daysBefore(90), staleAfterDays: 90 }, NOW).state).toBe(
      "stale",
    );
    expect(referenceFreshness({ lastVerifiedAt: daysBefore(89), staleAfterDays: 90 }, NOW).state).toBe(
      "fresh",
    );
  });

  it("applies the ceiling even when a row asks for longer — the stored budget cannot buy time", () => {
    const result = referenceFreshness(
      { lastVerifiedAt: daysBefore(100), staleAfterDays: 180 },
      NOW,
    );
    expect(result.budgetDays).toBe(90);
    expect(result.state).toBe("stale");
  });

  it("treats a never-confirmed row as unverified, not as fresh", () => {
    const result = referenceFreshness({ lastVerifiedAt: null, staleAfterDays: 90 }, NOW);
    expect(result.state).toBe("unverified");
    expect(result.ageDays).toBeNull();
    expect(result.dueAt).toBeNull();
    expect(result.requiresReverification).toBe(true);
  });

  it("ages a researched-but-unconfirmed row from its research date", () => {
    const result = referenceFreshness(
      { lastVerifiedAt: null, lastResearchedAt: daysBefore(120), staleAfterDays: 90 },
      NOW,
    );
    expect(result.state).toBe("stale");
    expect(result.ageDays).toBe(120);
  });

  it("prefers verification over research when both are present", () => {
    const result = referenceFreshness(
      {
        lastVerifiedAt: daysBefore(5),
        lastResearchedAt: daysBefore(400),
        staleAfterDays: 90,
      },
      NOW,
    );
    expect(result.state).toBe("fresh");
    expect(result.ageDays).toBe(5);
  });

  it("accepts ISO strings as well as Date instances", () => {
    const result = referenceFreshness(
      { lastVerifiedAt: daysBefore(10).toISOString(), staleAfterDays: 90 },
      NOW,
    );
    expect(result.state).toBe("fresh");
  });

  it("treats an unparseable timestamp as never confirmed rather than as now", () => {
    const result = referenceFreshness({ lastVerifiedAt: "not-a-date" }, NOW);
    expect(result.state).toBe("unverified");
  });
});

describe("describeReferenceFreshness", () => {
  it("states the limit out loud when a row cannot be presented as current", () => {
    const unverified = describeReferenceFreshness(
      referenceFreshness({ lastVerifiedAt: null }, NOW),
    );
    expect(unverified).toMatch(/unconfirmed/i);

    const stale = describeReferenceFreshness(
      referenceFreshness({ lastVerifiedAt: daysBefore(200) }, NOW),
    );
    expect(stale).toMatch(/unconfirmed/i);
    expect(stale).toContain("90-day");
  });
});

describe("the shipped reference corpora", () => {
  const dataDir = join(__dirname, "..", "data");

  function licenceRows(): Array<Record<string, unknown>> {
    const raw = JSON.parse(readFileSync(join(dataDir, "license_requirement_reference.json"), "utf8"));
    return Array.isArray(raw) ? raw : (Object.values(raw).find(Array.isArray) as never) ?? [];
  }

  it("ships no licence reference whose budget exceeds the 90-day ceiling", () => {
    const offenders = licenceRows()
      .map((row) => ({ id: row.requirementRefId, days: row.staleAfterDays as number }))
      .filter((row) => typeof row.days === "number" && row.days > MAX_REFERENCE_STALE_DAYS);

    expect(offenders).toEqual([]);
  });
});
