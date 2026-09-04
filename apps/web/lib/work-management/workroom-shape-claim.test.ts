// Round-trip and tolerance tests for the Workroom shape claim (BI-E0BFFF77).

import { describe, expect, it } from "vitest";

import {
  buildWorkroomShapeClaim,
  buildWorkShapeClaim,
  parseWorkShapeRef,
  readWorkroomShapeClaim,
  readWorkShapeClaim,
  resolveWorkShapeClaim,
  withWorkShapeClaim,
} from "./workroom-shape-claim";
import { OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY, getWorkShape } from "./work-shapes";

describe("workroom shape claim", () => {
  it("round-trips through the scopeClaims array form", () => {
    const claim = buildWorkroomShapeClaim("craft-stewardship", new Date("2026-08-16T00:00:00Z"));
    expect(claim).toEqual({
      workroomShape: "craft-stewardship",
      recordedAt: "2026-08-16T00:00:00.000Z",
    });
    const scopeClaims = [
      // Existing canonical ScopeClaim entries coexist untouched.
      {
        kind: "path", value: "apps/web/lib", intent: "edit",
        recordedAt: "2026-08-15T00:00:00.000Z", recordedByPrincipalId: "PRN-1",
      },
      claim,
    ];
    expect(readWorkroomShapeClaim(scopeClaims)).toBe("craft-stewardship");
  });

  it("reads the legacy object form", () => {
    expect(readWorkroomShapeClaim({ workroomShape: "outward-review" })).toBe("outward-review");
  });

  it("returns null for malformed or unknown claims without throwing", () => {
    expect(readWorkroomShapeClaim(null)).toBeNull();
    expect(readWorkroomShapeClaim(undefined)).toBeNull();
    expect(readWorkroomShapeClaim("outward-review")).toBeNull();
    expect(readWorkroomShapeClaim([])).toBeNull();
    expect(readWorkroomShapeClaim([{ workroomShape: "not-a-shape" }])).toBeNull();
    expect(readWorkroomShapeClaim([{ shape: "outward-review" }])).toBeNull();
    expect(readWorkroomShapeClaim({ workroomShape: 42 })).toBeNull();
  });

  it("returns the first valid declaration when several entries exist", () => {
    expect(
      readWorkroomShapeClaim([
        { workroomShape: "bogus" },
        { workroomShape: "specialist-alignment" },
        { workroomShape: "escalation" },
      ]),
    ).toBe("specialist-alignment");
  });
});


describe("declared work-shape claim", () => {
  const now = new Date("2026-08-30T00:00:00.000Z");
  const valid = `${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@1.0.0`;

  it("parses key@version and rejects unparseable values without throwing", () => {
    expect(parseWorkShapeRef(valid)).toEqual({
      key: OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY,
      version: "1.0.0",
    });
    expect(parseWorkShapeRef("not-a-ref")).toBeNull();
    expect(parseWorkShapeRef("foo@bar")).toBeNull();
    expect(parseWorkShapeRef("")).toBeNull();
    expect(parseWorkShapeRef(null)).toBeNull();
    expect(parseWorkShapeRef(42)).toBeNull();
  });

  it("round-trips through the scopeClaims array form", () => {
    const claim = buildWorkShapeClaim(valid, now);
    expect(claim).toEqual({ workShape: valid, recordedAt: "2026-08-30T00:00:00.000Z" });
    const scopeClaims = [
      {
        kind: "path", value: "apps/web/lib", intent: "edit",
        recordedAt: "2026-08-15T00:00:00.000Z", recordedByPrincipalId: "PRN-1",
      },
      { workroomShape: "craft-stewardship", recordedAt: "2026-08-16T00:00:00.000Z" },
      claim,
    ];
    expect(readWorkShapeClaim(scopeClaims)).toEqual({
      key: OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY,
      version: "1.0.0",
    });
    expect(resolveWorkShapeClaim(scopeClaims)?.key).toBe(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY);
  });

  it("resolves a known key@version from the canonical registry", () => {
    const shape = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    expect(resolveWorkShapeClaim([{ workShape: valid }])?.version).toBe(shape.version);
  });

  it("resolves unknown or version-mismatched claims as null without throwing", () => {
    expect(resolveWorkShapeClaim([{ workShape: "unknown-shape@1.0.0" }])).toBeNull();
    expect(resolveWorkShapeClaim([{ workShape: `${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@9.9.9` }])).toBeNull();
    expect(resolveWorkShapeClaim([{ workShape: "garbage" }])).toBeNull();
    expect(resolveWorkShapeClaim(null)).toBeNull();
    expect(readWorkShapeClaim([{ workShapeKey: OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY, workShapeVersion: "1.0.0" }])).toEqual({
      key: OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY,
      version: "1.0.0",
    });
  });

  it("replaces an existing work-shape claim rather than appending a second one", () => {
    const first = withWorkShapeClaim([], valid, now);
    const second = withWorkShapeClaim(first, `${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@1.0.0`, new Date("2026-08-31T00:00:00.000Z"));
    expect(second.filter((entry) => readWorkShapeClaim([entry]) !== null)).toHaveLength(1);
  });
});
