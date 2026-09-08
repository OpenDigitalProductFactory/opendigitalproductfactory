import { describe, expect, it } from "vitest";

import {
  readWorkroomBoundaryClaim,
  withWorkroomBoundaryClaim,
} from "./workroom-boundary-claim";

const SHAPE_ENTRY = { workroomShape: "specialist-alignment", recordedAt: "2026-09-01T00:00:00.000Z" };

describe("readWorkroomBoundaryClaim", () => {
  it("reads a declared boundary out of the canonical array form", () => {
    const claim = readWorkroomBoundaryClaim([
      SHAPE_ENTRY,
      { workroomBoundary: { outcome: "The licence register is current", accountablePrincipalRef: "role:compliance-owner" } },
    ]);

    expect(claim?.outcome).toBe("The licence register is current");
    expect(claim?.accountablePrincipalRef).toBe("role:compliance-owner");
  });

  it("tolerates the legacy bare-object form, as the shape claim does", () => {
    const claim = readWorkroomBoundaryClaim({ workroomBoundary: { outcome: "Done" } });
    expect(claim?.outcome).toBe("Done");
  });

  it("returns null rather than throwing on malformed input", () => {
    for (const input of [null, undefined, 42, "nope", [], [null], [{ workroomBoundary: 7 }]]) {
      expect(readWorkroomBoundaryClaim(input)).toBeNull();
    }
  });

  it("treats a claim that declares nothing as no claim at all", () => {
    // The whole point of the notice is to separate "nobody bounded this room"
    // from "somebody bounded it" — an empty save must not read as the latter.
    expect(readWorkroomBoundaryClaim([{ workroomBoundary: { outcome: "   ", measures: [] } }])).toBeNull();
  });

  it("trims text and drops blank list entries", () => {
    const claim = readWorkroomBoundaryClaim([
      { workroomBoundary: { outcome: "  shipped  ", measures: ["  a  ", "", "   "] } },
    ]);
    expect(claim?.outcome).toBe("shipped");
    expect(claim?.measures).toEqual(["a"]);
  });
});

describe("withWorkroomBoundaryClaim", () => {
  it("preserves every other claim, including the declared shape", () => {
    const next = withWorkroomBoundaryClaim([SHAPE_ENTRY], { outcome: "Shipped" });
    expect(next).toContainEqual(SHAPE_ENTRY);
    expect(next).toHaveLength(2);
  });

  it("replaces a prior boundary rather than appending, so edits do not accumulate", () => {
    const first = withWorkroomBoundaryClaim([SHAPE_ENTRY], { outcome: "First" });
    const second = withWorkroomBoundaryClaim(first, { outcome: "Second" });

    expect(second).toHaveLength(2);
    expect(readWorkroomBoundaryClaim(second)?.outcome).toBe("Second");
  });

  it("clearing every field removes the claim instead of storing an empty one", () => {
    const withClaim = withWorkroomBoundaryClaim([SHAPE_ENTRY], { outcome: "Shipped" });
    const cleared = withWorkroomBoundaryClaim(withClaim, { outcome: "" });

    expect(cleared).toEqual([SHAPE_ENTRY]);
    expect(readWorkroomBoundaryClaim(cleared)).toBeNull();
  });

  it("stamps recordedAt so a boundary can be aged", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const next = withWorkroomBoundaryClaim([], { outcome: "Shipped" }, now);
    expect(readWorkroomBoundaryClaim(next)?.recordedAt).toBe(now.toISOString());
  });

  it("accepts a non-array scopeClaims value without losing it", () => {
    const next = withWorkroomBoundaryClaim(SHAPE_ENTRY, { outcome: "Shipped" });
    expect(next).toContainEqual(SHAPE_ENTRY);
  });
});
