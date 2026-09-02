// A room can be convened WITH the activity shape that drives it (BI-A967717A).
//
// Before this, the drive runner shipped, ran every 15 minutes, and skipped every
// room — because `create_workroom` had no way to declare a work shape, and the
// drive reads exactly that claim. These tests hold the seam closed end to end:
// what the scope normalizer accepts, what the store writes, and that what it
// writes is what the drive can actually read back.

import { describe, expect, it } from "vitest";

import { normalizeWorkCapsuleScopeInput } from "../work-capsules";
import { DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY } from "./standing-operations-shapes";
import { getWorkShape } from "./work-shapes";
import { readWorkShapeClaim, resolveWorkShapeClaim } from "./workroom-shape-claim";

const REF = `${DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY}@1.0.0`;

describe("declaring a room's activity shape", () => {
  it("accepts a well-formed key@version reference", () => {
    expect(normalizeWorkCapsuleScopeInput({ workShape: REF }).workShape).toBe(REF);
  });

  it("treats an absent shape as absent, not as an error", () => {
    // Most rooms are not standing activities. Convening one must stay unchanged.
    for (const value of [undefined, null, ""]) {
      expect(normalizeWorkCapsuleScopeInput({ workShape: value }).workShape).toBeNull();
    }
    expect(normalizeWorkCapsuleScopeInput().workShape).toBeNull();
  });

  it("refuses a malformed reference rather than storing a claim that can never match", () => {
    // A claim the drive can never resolve is worse than no claim: the room looks
    // declared and behaves inert, which is the exact failure this work exists to end.
    for (const bad of ["dependency-advisory-watch", "shape@1", "shape@v1.0.0", "@1.0.0", "a b@1.0.0"]) {
      expect(() => normalizeWorkCapsuleScopeInput({ workShape: bad }), bad).toThrow(/key@version/);
    }
  });

  it("keeps the collaboration shape and the activity shape as separate claims", () => {
    // One says who must be in the room for a consequential act; the other says
    // what wakes the room. Collapsing them would lose a distinction the runner
    // depends on.
    const scope = normalizeWorkCapsuleScopeInput({
      workroomShape: "approval-sign-off",
      workShape: REF,
    });
    expect(scope.workroomShape).toBe("approval-sign-off");
    expect(scope.workShape).toBe(REF);
  });
});

describe("the claim the store writes is the claim the drive reads", () => {
  /** The scopeClaims array exactly as createWorkCapsule composes it. */
  function scopeClaimsFor(input: { workroomShape?: string; workShape?: string }): unknown[] {
    const scope = normalizeWorkCapsuleScopeInput(input);
    const recordedAt = new Date("2026-09-02T00:00:00.000Z").toISOString();
    return [
      ...(scope.workroomShape ? [{ workroomShape: scope.workroomShape, recordedAt }] : []),
      ...(scope.workShape ? [{ workShape: scope.workShape, recordedAt }] : []),
    ];
  }

  it("round-trips through the reader the drive uses", () => {
    const claims = scopeClaimsFor({ workroomShape: "approval-sign-off", workShape: REF });
    const ref = readWorkShapeClaim(claims);
    expect(ref).toEqual({ key: DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY, version: "1.0.0" });
  });

  it("resolves to a real registered shape, so the drive can plan a stage", () => {
    // The end-to-end property: convene → persist → the drive finds a definition.
    // If this fails, a room declared through the governed path is still inert.
    const claims = scopeClaimsFor({ workShape: REF });
    const shape = resolveWorkShapeClaim(claims);
    expect(shape).not.toBeNull();
    expect(shape?.key).toBe(DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY);
    expect(shape?.stages.length).toBeGreaterThan(0);
    expect(getWorkShape(DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY)).not.toBeNull();
  });

  it("leaves a room with no activity shape unresolvable, exactly as before", () => {
    const claims = scopeClaimsFor({ workroomShape: "approval-sign-off" });
    expect(readWorkShapeClaim(claims)).toBeNull();
    expect(resolveWorkShapeClaim(claims)).toBeNull();
  });
});
