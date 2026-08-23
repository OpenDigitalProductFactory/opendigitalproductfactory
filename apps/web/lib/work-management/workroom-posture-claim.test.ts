import { describe, expect, it } from "vitest";

import {
  buildWorkroomPostureClaim,
  readWorkroomPostureClaim,
  withWorkroomPostureClaim,
} from "./workroom-posture-claim";

const BALANCED = {
  costWeight: 1 / 3,
  qualityWeight: 1 / 3,
  timeWeight: 1 / 3,
  preset: "balanced" as const,
};

describe("readWorkroomPostureClaim", () => {
  it("reads a declaration from the array form", () => {
    const claims = [
      { kind: "path", value: "apps/web", intent: "edit" },
      { workroomShape: "escalation", recordedAt: "2026-08-22T00:00:00.000Z" },
      { workroomPosture: { proactivityLevel: "quiet" }, recordedAt: "2026-08-22T00:00:00.000Z" },
    ];
    expect(readWorkroomPostureClaim(claims)).toEqual({ proactivityLevel: "quiet" });
  });

  it("reads a declaration from the legacy object form", () => {
    expect(
      readWorkroomPostureClaim({ workroomPosture: { actionBoundary: "advise" } }),
    ).toEqual({ actionBoundary: "advise" });
  });

  it("returns null for claims with no posture entry", () => {
    expect(readWorkroomPostureClaim([{ kind: "path", value: "x", intent: "edit" }])).toBeNull();
    expect(readWorkroomPostureClaim([])).toBeNull();
    expect(readWorkroomPostureClaim(null)).toBeNull();
    expect(readWorkroomPostureClaim("nonsense")).toBeNull();
    expect(readWorkroomPostureClaim(42)).toBeNull();
  });

  it("drops unrecognised values rather than trusting them", () => {
    expect(
      readWorkroomPostureClaim([
        { workroomPosture: { proactivityLevel: "SHOUTING", actionBoundary: "advise" } },
      ]),
    ).toEqual({ actionBoundary: "advise" });
  });

  it("treats an entry that declared nothing recognisable as no declaration", () => {
    // An empty object would read downstream as "the room chose defaults",
    // which is a different and wrong statement from "the room chose nothing".
    expect(readWorkroomPostureClaim([{ workroomPosture: { proactivityLevel: "nope" } }])).toBeNull();
    expect(readWorkroomPostureClaim([{ workroomPosture: {} }])).toBeNull();
  });

  it("accepts a full declaration including priority", () => {
    expect(
      readWorkroomPostureClaim([
        {
          workroomPosture: {
            proactivityLevel: "assertive",
            actionBoundary: "propose",
            priority: BALANCED,
            declaredBy: "principal:1",
            declaredAt: "2026-08-22T00:00:00.000Z",
          },
        },
      ]),
    ).toEqual({
      proactivityLevel: "assertive",
      actionBoundary: "propose",
      priority: BALANCED,
      declaredBy: "principal:1",
      declaredAt: "2026-08-22T00:00:00.000Z",
    });
  });

  it("rejects a malformed priority while keeping the rest", () => {
    expect(
      readWorkroomPostureClaim([
        { workroomPosture: { proactivityLevel: "quiet", priority: { costWeight: "lots" } } },
      ]),
    ).toEqual({ proactivityLevel: "quiet" });
  });
});

describe("withWorkroomPostureClaim", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("preserves every unrelated claim entry", () => {
    const claims = [
      { kind: "path", value: "apps/web", intent: "edit" },
      { workroomShape: "escalation", recordedAt: "2026-08-22T00:00:00.000Z" },
    ];
    const next = withWorkroomPostureClaim(claims, { proactivityLevel: "quiet" }, now);
    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(claims[0]);
    expect(next[1]).toEqual(claims[1]);
  });

  it("replaces an existing posture claim rather than appending a second", () => {
    const first = withWorkroomPostureClaim([], { proactivityLevel: "quiet" }, now);
    const second = withWorkroomPostureClaim(first, { proactivityLevel: "assertive" }, now);
    expect(second.filter((e) => readWorkroomPostureClaim([e]) !== null)).toHaveLength(1);
    expect(readWorkroomPostureClaim(second)).toEqual({ proactivityLevel: "assertive" });
  });

  it("round-trips through the reader", () => {
    const declaration = { proactivityLevel: "assertive" as const, actionBoundary: "advise" as const };
    expect(readWorkroomPostureClaim(withWorkroomPostureClaim([], declaration, now))).toEqual(
      declaration,
    );
  });

  it("stamps the claim with the supplied instant", () => {
    expect(buildWorkroomPostureClaim({ proactivityLevel: "quiet" }, now).recordedAt).toBe(
      "2026-08-22T12:00:00.000Z",
    );
  });
});
