import { describe, expect, it } from "vitest";

import {
  arbitrate,
  buildDispositions,
  drawAgainstCapacity,
  type ArbitrationCandidate,
} from "./arbitration";

const at = (iso: string) => new Date(iso);
const candidate = (overrides: Partial<ArbitrationCandidate> & { ref: string }): ArbitrationCandidate => ({
  title: overrides.ref,
  score: 5,
  submittedAt: at("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("arbitrate", () => {
  it("puts a value-stream blocker first regardless of score or tally", () => {
    // A shop that cannot take orders is not outvoted by a hundred installs
    // wanting a nicer report.
    const ordered = arbitrate([
      candidate({ ref: "popular", score: 99, affectedOrganizations: 100 }),
      candidate({ ref: "blocker", score: 1, blocksValueStream: true }),
    ]);
    expect(ordered.map((e) => e.ref)).toEqual(["blocker", "popular"]);
    expect(ordered[0].rationale).toContain("blocks a core value stream");
  });

  it("orders by the score the demand engine already computed", () => {
    const ordered = arbitrate([
      candidate({ ref: "low", score: 1 }),
      candidate({ ref: "high", score: 9 }),
    ]);
    expect(ordered.map((e) => e.ref)).toEqual(["high", "low"]);
  });

  it("breaks a score tie on breadth, not intensity", () => {
    const ordered = arbitrate([
      candidate({ ref: "narrow", affectedOrganizations: 1 }),
      candidate({ ref: "wide", affectedOrganizations: 12 }),
    ]);
    expect(ordered.map((e) => e.ref)).toEqual(["wide", "narrow"]);
  });

  it("breaks a remaining tie on age, so a minority submitter is not starved forever", () => {
    const ordered = arbitrate([
      candidate({ ref: "new", submittedAt: at("2026-09-10T00:00:00Z") }),
      candidate({ ref: "old", submittedAt: at("2026-01-01T00:00:00Z") }),
    ]);
    expect(ordered.map((e) => e.ref)).toEqual(["old", "new"]);
  });

  it("sorts an unscored item last rather than treating it as zero", () => {
    const ordered = arbitrate([
      candidate({ ref: "unscored", score: null }),
      candidate({ ref: "negative", score: -3 }),
    ]);
    expect(ordered.map((e) => e.ref)).toEqual(["negative", "unscored"]);
  });

  it("is deterministic — two runs over the same input never disagree", () => {
    const input = [candidate({ ref: "b" }), candidate({ ref: "a" }), candidate({ ref: "c" })];
    expect(arbitrate(input).map((e) => e.ref)).toEqual(arbitrate(input).map((e) => e.ref));
  });

  it("explains every position in plain language", () => {
    const ordered = arbitrate([candidate({ ref: "a", affectedOrganizations: 2, answeredAt: null })]);
    expect(ordered[0].rationale).toContain("2 organizations affected");
    expect(ordered[0].rationale).toContain("still unanswered");
  });
});

describe("drawAgainstCapacity", () => {
  it("funds down to the line and leaves the rest VISIBLE in order", () => {
    const entries = arbitrate([
      candidate({ ref: "a", score: 9 }),
      candidate({ ref: "b", score: 5 }),
      candidate({ ref: "c", score: 1 }),
    ]);
    const draw = drawAgainstCapacity(entries, 2);
    expect(draw.funded.map((e) => e.ref)).toEqual(["a", "b"]);
    expect(draw.queued.map((e) => e.ref)).toEqual(["c"]);
  });

  it("queues everything when there is no capacity, rather than dropping it", () => {
    const entries = arbitrate([candidate({ ref: "a" })]);
    expect(drawAgainstCapacity(entries, 0)).toEqual({ funded: [], queued: entries });
  });
});

describe("buildDispositions", () => {
  it("answers EVERY submission — funded and queued alike", () => {
    // A queue that answers nobody is the Ubuntu Brainstorm failure.
    const entries = arbitrate([candidate({ ref: "a", score: 9 }), candidate({ ref: "b", score: 1 })]);
    const notices = buildDispositions(drawAgainstCapacity(entries, 1));
    expect(notices.map((n) => n.ref).sort()).toEqual(["a", "b"]);
  });

  it("tells a deferred submitter where they actually stand", () => {
    const entries = arbitrate([candidate({ ref: "a", score: 9 }), candidate({ ref: "b", score: 1 })]);
    const notices = buildDispositions(drawAgainstCapacity(entries, 1));
    const deferred = notices.find((n) => n.ref === "b");
    expect(deferred).toMatchObject({ outcome: "deferred" });
    expect(deferred?.reason).toContain("position 2");
  });

  it("never emits a bare verdict with no reason", () => {
    const entries = arbitrate([candidate({ ref: "a" })]);
    for (const notice of buildDispositions(drawAgainstCapacity(entries, 1))) {
      expect(notice.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
