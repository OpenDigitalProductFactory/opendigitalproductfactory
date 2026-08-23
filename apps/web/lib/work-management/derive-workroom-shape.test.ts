import { describe, expect, it } from "vitest";

import { deriveWorkroomShape } from "./derive-workroom-shape";
import { WORKROOM_SHAPE_KEYS } from "./room-shapes";

describe("deriveWorkroomShape", () => {
  it("derives craft-stewardship for a standing profession room", () => {
    expect(
      deriveWorkroomShape({ mode: "standing", decisionScope: "wsid" })?.shape,
    ).toBe("craft-stewardship");
  });

  it("derives specialist-alignment for craft judgment and for a finite profession room", () => {
    expect(deriveWorkroomShape({ activityKind: "craft-judgment" })?.shape).toBe(
      "specialist-alignment",
    );
    expect(deriveWorkroomShape({ decisionScope: "wsid", mode: "finite" })?.shape).toBe(
      "specialist-alignment",
    );
  });

  it("derives approval-sign-off for a readiness gate", () => {
    expect(deriveWorkroomShape({ activityKind: "launch-readiness" })?.shape).toBe(
      "approval-sign-off",
    );
  });

  it("derives change-consequential for governance and remediation", () => {
    expect(deriveWorkroomShape({ activityKind: "governance" })?.shape).toBe(
      "change-consequential",
    );
    expect(deriveWorkroomShape({ activityKind: "remediation" })?.shape).toBe(
      "change-consequential",
    );
  });

  describe("refuses to guess", () => {
    // The load-bearing half. A derivation that invented a shape for every room
    // would be an over-reporting measure: nobody could tell an invented shape
    // from a declared one, and the posture would act on fiction.
    it.each(["delivery", "support", "improvement", "lifecycle"])(
      "returns null for %s, which does not identify a shape",
      (activityKind) => {
        expect(deriveWorkroomShape({ activityKind })).toBeNull();
      },
    );

    it("returns null for a bare platform or business scope", () => {
      expect(deriveWorkroomShape({ decisionScope: "wwmd" })).toBeNull();
      expect(deriveWorkroomShape({ decisionScope: "wwwd" })).toBeNull();
    });

    it("returns null when the room says nothing at all", () => {
      expect(deriveWorkroomShape({})).toBeNull();
      expect(deriveWorkroomShape(null)).toBeNull();
      expect(deriveWorkroomShape(undefined)).toBeNull();
    });

    it("returns null for an activityKind outside the enum", () => {
      // Live data carries at least one such row ("embedding-coverage"); an
      // unrecognised value must contribute nothing rather than fall through
      // to a default shape.
      expect(deriveWorkroomShape({ activityKind: "embedding-coverage" })).toBeNull();
    });
  });

  it("only ever returns a real shape key", () => {
    const cases = [
      { mode: "standing", decisionScope: "wsid" },
      { activityKind: "craft-judgment" },
      { activityKind: "launch-readiness" },
      { activityKind: "governance" },
      { activityKind: "remediation" },
      { decisionScope: "wsid", mode: "finite" },
    ];
    for (const c of cases) {
      const derived = deriveWorkroomShape(c)!;
      expect(WORKROOM_SHAPE_KEYS).toContain(derived.shape);
      expect(derived.reasonCode).toMatch(/^[a-z0-9_]+$/);
      expect(derived.reason.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const args = { activityKind: "governance", decisionScope: "wwmd", mode: "finite" };
    expect(deriveWorkroomShape(args)).toEqual(deriveWorkroomShape(args));
  });
});
