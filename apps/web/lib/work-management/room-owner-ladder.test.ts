// The ownership ladder (BI-24E7D59F, Coordinated Workrooms plan Phase B).
//
// deriveRoomCoordinator promotes the single accountable PARTICIPANT. That works
// for a room somebody staffed. All twelve standing rooms on this install have
// participantCount: 0 — there is nobody to promote, so every one of them refused
// on missing_explicit_coordinator, ~2,500 consecutive wakes between them.
//
// The rung that unsticks them is the work shape, which already names who answers
// for each stage. This ladder reads it.
//
// The rule that matters most here is the one that says NO: a derived owner who is
// wrong is worse than none, because the room then looks owned and still refuses —
// indistinguishable from the bug being fixed. Unresolvable resolves null and is
// reported.

import { describe, expect, it } from "vitest";

import { resolveRoomOwner, type RoomOwnerInputs } from "./room-owner-ladder";

const shape = {
  key: "dependency-advisory-watch",
  stages: [
    { key: "sweep", accountablePrincipalRef: "agent:security-engineer", advance: { kind: "status-change" as const, condition: "c" } },
    { key: "raise", accountablePrincipalRef: "agent:security-engineer", advance: { kind: "status-change" as const, condition: "c" } },
    {
      key: "decide",
      accountablePrincipalRef: "role:security-owner",
      advance: { kind: "governed-decision" as const, condition: "c", decisionScope: "wwmd" },
    },
  ],
};

function inputs(over: Partial<RoomOwnerInputs> = {}): RoomOwnerInputs {
  return { explicitPrincipalRef: null, shape, archetypePrincipalRef: null, ...over };
}

describe("resolveRoomOwner", () => {
  it("prefers an explicit appointment over everything below it", () => {
    const owner = resolveRoomOwner(inputs({ explicitPrincipalRef: "PRN-HUMAN-1" }));
    expect(owner).toEqual({ principalRef: "PRN-HUMAN-1", source: "explicit" });
  });

  it("falls to the shape's executing principal when nobody was appointed", () => {
    // This is the rung that unsticks the twelve standing rooms.
    const owner = resolveRoomOwner(inputs());
    expect(owner).toEqual({ principalRef: "agent:security-engineer", source: "shape" });
  });

  it("never derives the stage that holds the governed decision", () => {
    // conformance treats coordinator_approver_overlap as a deviation, so deriving
    // the approver would swap one refusal for another and look like progress.
    const owner = resolveRoomOwner(inputs());
    expect(owner?.principalRef).not.toBe("role:security-owner");
  });

  it("refuses to guess when the executing stages disagree", () => {
    const owner = resolveRoomOwner(
      inputs({
        shape: {
          key: "split",
          stages: [
            { key: "a", accountablePrincipalRef: "agent:one", advance: { kind: "status-change", condition: "c" } },
            { key: "b", accountablePrincipalRef: "agent:two", advance: { kind: "status-change", condition: "c" } },
          ],
        },
      }),
    );
    // Two candidates is not a tie to break; it is a shape that has not said who
    // drives. Reported, not guessed.
    expect(owner).toBeNull();
  });

  it("falls to the archetype default when the room has no shape", () => {
    const owner = resolveRoomOwner(inputs({ shape: null, archetypePrincipalRef: "agent:coo-orchestrator" }));
    expect(owner).toEqual({ principalRef: "agent:coo-orchestrator", source: "archetype" });
  });

  it("returns null — not a plausible coworker — when no rung resolves", () => {
    expect(resolveRoomOwner(inputs({ shape: null }))).toBeNull();
  });

  it("returns null when every stage is a governed decision", () => {
    // A shape that is nothing but approvals has no driver to derive.
    const owner = resolveRoomOwner(
      inputs({
        shape: {
          key: "approvals-only",
          stages: [
            {
              key: "decide",
              accountablePrincipalRef: "role:owner",
              advance: { kind: "governed-decision", condition: "c", decisionScope: "wwmd" },
            },
          ],
        },
      }),
    );
    expect(owner).toBeNull();
  });

  it("ignores a shape with no stages rather than throwing", () => {
    expect(resolveRoomOwner(inputs({ shape: { key: "empty", stages: [] } }))).toBeNull();
  });

  it("keeps the ladder strictly ordered", () => {
    // shape beats archetype, explicit beats both — asserted together so a later
    // reordering cannot pass by satisfying only one case.
    expect(
      resolveRoomOwner(inputs({ archetypePrincipalRef: "agent:coo-orchestrator" }))?.source,
    ).toBe("shape");
    expect(
      resolveRoomOwner(
        inputs({ explicitPrincipalRef: "PRN-1", archetypePrincipalRef: "agent:coo-orchestrator" }),
      )?.source,
    ).toBe("explicit");
  });
});
