import { describe, expect, it } from "vitest";

import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";

import type { GuardOutcomeCount, GuardRunDay } from "./guard-outcome-store";
import { PAIRING_PROXY_LIMITATION } from "./efficacy-measures";
import { buildGuardEvidence, fileRetirementReviews, type ReviewItemState } from "./guard-retirement-filing";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-31T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const FIXTURE = "loop:check-no-fixture";

/** Emulates ingestBacklogItem's origin dedupe against open items. */
function fakeBacklog() {
  const open = new Map<string, string>();
  const filed: BacklogIngestInput[] = [];
  let next = 1;
  return {
    filed,
    async file(input: BacklogIngestInput) {
      const marker = `${input.origin?.kind}:${input.origin?.id}`;
      const existing = open.get(marker);
      if (existing) return { itemId: existing, id: existing, created: false, implementationCandidates: [] };
      const itemId = `BI-GUARD-${next++}`;
      open.set(marker, itemId);
      filed.push(input);
      return { itemId, id: itemId, created: true, implementationCandidates: [] };
    },
  };
}

function runDays(guardId: string, days: number, refusalsPerDay: number): GuardRunDay[] {
  return Array.from({ length: days }, (_, i) => ({
    guardId,
    guardDigest: "d".repeat(64),
    day: daysAgo(days - i),
    runs: 2,
    refusals: refusalsPerDay,
    totalDurationMs: 4_000,
  }));
}

function outcomes(guardId: string, counts: Record<string, number>): GuardOutcomeCount[] {
  return Object.entries(counts).map(([outcome, count]) => ({ guardId, outcome, reason: outcome, refusedAt: daysAgo(20), count }));
}

function evidenceFor(declarations: Record<string, unknown> = {}, reviewItems = new Map<string, ReviewItemState>()) {
  return buildGuardEvidence({
    now: NOW,
    runDays: [...runDays(FIXTURE, 100, 0), ...runDays("loop:check-no-deterrent", 100, 0)],
    outcomes: outcomes(FIXTURE, { caught: 0, "false-refusal": 4, overridden: 1, unresolved: 1 }),
    declarations,
    reviewItems,
    medianDurations: new Map([[FIXTURE, 1_900]]),
    earliestRecordAt: daysAgo(120),
  });
}

describe("fileRetirementReviews — AC-GOE-05", () => {
  it("files exactly one item for a fixture guard with zero catches and a high false-refusal rate", async () => {
    const backlog = fakeBacklog();
    const result = await fileRetirementReviews({ now: NOW, guards: evidenceFor(), file: backlog.file });
    const perGuard = backlog.filed.filter((item) => item.origin?.kind === "guard-retirement-review");
    expect(perGuard).toHaveLength(1);
    expect(perGuard[0]).toMatchObject({
      origin: { kind: "guard-retirement-review", id: FIXTURE },
      source: "automated-detection",
      workType: "chore",
    });
    expect(perGuard[0].title).toContain("false refusals 4 of 4 decided refusals (100%)");
    expect(perGuard[0].body).toContain("Nothing was disabled or deleted");
    expect(perGuard[0].body).toContain(PAIRING_PROXY_LIMITATION);
    expect(result.filed).toEqual([{ guardId: FIXTURE, itemId: "BI-GUARD-1", created: true, rule: "R-2" }]);
  });

  it("states the outcome that closes each review item (BI-458CCA8D)", async () => {
    const backlog = fakeBacklog();
    await fileRetirementReviews({ now: NOW, guards: evidenceFor(), file: backlog.file });
    const perGuard = backlog.filed.find((item) => item.origin?.kind === "guard-retirement-review");
    const digest = backlog.filed.find((item) => item.origin?.kind === "guard-retirement-digest");
    expect(perGuard?.outcome).toBe(`\`${FIXTURE}\` is retired, narrowed so it stops refusing correct work, or kept with an owner and an expiry.`);
    expect(digest?.outcome).toBe("Each guard listed is retired, narrowed, or kept with an owner and an expiry.");
  });

  it("a second evaluation files nothing new", async () => {
    const backlog = fakeBacklog();
    await fileRetirementReviews({ now: NOW, guards: evidenceFor(), file: backlog.file });
    const reviewItems = new Map([[FIXTURE, { guardId: FIXTURE, open: true, closedAt: null }]]);
    const second = await fileRetirementReviews({ now: NOW, guards: evidenceFor({}, reviewItems), file: backlog.file });
    expect(second.filed.every((f) => !f.created)).toBe(true);
    expect(backlog.filed.filter((item) => item.origin?.kind === "guard-retirement-review")).toHaveLength(1);
  });

  it("an unexpired keep files nothing for that guard", async () => {
    const backlog = fakeBacklog();
    const declarations = {
      [FIXTURE]: { owner: "platform", purpose: "p", catchClass: "c", keep: { owner: "platform", expiry: "2027-06-30", reason: "deterrent", decisionRef: "DI-1" } },
    };
    const result = await fileRetirementReviews({ now: NOW, guards: evidenceFor(declarations), file: backlog.file });
    expect(result.filed).toEqual([]);
    expect(result.evaluation.silencedByKeep).toContain(FIXTURE);
  });

  it("puts never-refused guards in one weekly digest item", async () => {
    const backlog = fakeBacklog();
    const result = await fileRetirementReviews({ now: NOW, guards: evidenceFor(), file: backlog.file });
    expect(result.digest).toMatchObject({ created: true, guards: 1 });
    const digest = backlog.filed.find((item) => item.origin?.kind === "guard-retirement-digest");
    expect(digest?.origin?.id).toBe("2026-W53");
    expect(digest?.body).toContain("loop:check-no-deterrent");
  });

  it("a closed review restarts the window, so the guard is not re-filed on thin new evidence", async () => {
    const backlog = fakeBacklog();
    const reviewItems = new Map([[FIXTURE, { guardId: FIXTURE, open: false, closedAt: daysAgo(10) }]]);
    const result = await fileRetirementReviews({ now: NOW, guards: evidenceFor({}, reviewItems), file: backlog.file });
    expect(result.filed).toEqual([]);
  });
});
