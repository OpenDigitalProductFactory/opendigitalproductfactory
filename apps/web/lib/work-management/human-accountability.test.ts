import { describe, expect, it } from "vitest";

import {
  describeAccountabilityProvenance,
  isResponsibilityRelation,
  RESPONSIBILITY_RELATIONS_ARE_KNOWN,
  resolveEffectiveHumanAccountability,
  type AccountabilityEdge,
} from "./human-accountability";

const OWNER = "PRN-OWNER";
const contains = (parent: string, child: string): AccountabilityEdge => ({
  fromWorkroomId: parent, toWorkroomId: child, relation: "contains",
});

describe("resolveEffectiveHumanAccountability", () => {
  it("defaults to the organization owner when nothing is assigned, including a solo founder", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-1",
      rooms: [{ workroomId: "WC-1", accountablePrincipalIds: [] }],
      edges: [],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toEqual({ state: "resolved", principalId: OWNER, source: "organization-owner", inheritedFrom: [] });
  });

  it("prefers an explicit assignment on the room over the organization owner", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-1",
      rooms: [{ workroomId: "WC-1", accountablePrincipalIds: ["PRN-ALEX"] }],
      edges: [],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ state: "resolved", principalId: "PRN-ALEX", source: "explicit-room" });
  });

  it("inherits from the nearest ancestor through multiple delegation levels", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-LEAF",
      rooms: [
        { workroomId: "WC-LEAF", accountablePrincipalIds: [] },
        { workroomId: "WC-MID", accountablePrincipalIds: [] },
        { workroomId: "WC-FINANCE", accountablePrincipalIds: ["PRN-ALEX"] },
      ],
      edges: [contains("WC-FINANCE", "WC-MID"), contains("WC-MID", "WC-LEAF")],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ state: "resolved", principalId: "PRN-ALEX", source: "inherited-room" });
    expect(result).toHaveProperty("inheritedFrom", ["WC-LEAF", "WC-MID", "WC-FINANCE"]);
  });

  it("lets a descendant override its ancestor rather than inheriting", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-LEAF",
      rooms: [
        { workroomId: "WC-LEAF", accountablePrincipalIds: ["PRN-SAM"] },
        { workroomId: "WC-FINANCE", accountablePrincipalIds: ["PRN-ALEX"] },
      ],
      edges: [contains("WC-FINANCE", "WC-LEAF")],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ principalId: "PRN-SAM", source: "explicit-room" });
  });

  it("recomputes to the ancestor when a delegate's assignment is revoked", () => {
    const rooms = [
      { workroomId: "WC-LEAF", accountablePrincipalIds: [] as string[] },
      { workroomId: "WC-FINANCE", accountablePrincipalIds: ["PRN-ALEX"] },
    ];
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-LEAF", rooms, edges: [contains("WC-FINANCE", "WC-LEAF")],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ principalId: "PRN-ALEX", source: "inherited-room" });
  });

  it("never treats a dependency as an ownership edge", () => {
    for (const relation of ["depends-on", "blocks", "contributes-to"]) {
      const result = resolveEffectiveHumanAccountability({
        workroomId: "WC-LEAF",
        rooms: [
          { workroomId: "WC-LEAF", accountablePrincipalIds: [] },
          { workroomId: "WC-OTHER", accountablePrincipalIds: ["PRN-NOT-OWNER"] },
        ],
        edges: [{ fromWorkroomId: "WC-OTHER", toWorkroomId: "WC-LEAF", relation }],
        organizationTopAccountablePrincipalId: OWNER,
      });
      expect(result).toMatchObject({ principalId: OWNER, source: "organization-owner" });
    }
  });

  it("asks for correction instead of guessing when a room names two accountable principals", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-1",
      rooms: [{ workroomId: "WC-1", accountablePrincipalIds: ["PRN-A", "PRN-B"] }],
      edges: [],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ state: "setup-required", reason: "conflicting-accountable-principals", atWorkroomId: "WC-1" });
  });

  it("stops at ambiguous ancestry rather than picking a container", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-LEAF",
      rooms: [
        { workroomId: "WC-LEAF", accountablePrincipalIds: [] },
        { workroomId: "WC-A", accountablePrincipalIds: ["PRN-A"] },
        { workroomId: "WC-B", accountablePrincipalIds: ["PRN-B"] },
      ],
      edges: [contains("WC-A", "WC-LEAF"), contains("WC-B", "WC-LEAF")],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ principalId: OWNER, source: "organization-owner" });
  });

  it("reports a responsibility cycle instead of looping", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-A",
      rooms: [
        { workroomId: "WC-A", accountablePrincipalIds: [] },
        { workroomId: "WC-B", accountablePrincipalIds: [] },
      ],
      edges: [contains("WC-A", "WC-B"), contains("WC-B", "WC-A")],
      organizationTopAccountablePrincipalId: null,
    });
    expect(result).toMatchObject({ state: "setup-required", reason: "responsibility-cycle" });
  });

  it("produces an actionable setup state, never a guessed principal, when no owner is recorded", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-1",
      rooms: [{ workroomId: "WC-1", accountablePrincipalIds: [] }],
      edges: [],
      organizationTopAccountablePrincipalId: null,
    });
    expect(result).toMatchObject({ state: "setup-required", reason: "no-organization-owner-recorded" });
    expect(JSON.stringify(result)).not.toContain("PRN-");
  });

  it("treats a blank recorded owner as unset rather than as a principal", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-1",
      rooms: [{ workroomId: "WC-1", accountablePrincipalIds: [] }],
      edges: [],
      organizationTopAccountablePrincipalId: "   ",
    });
    expect(result).toMatchObject({ state: "setup-required", reason: "no-organization-owner-recorded" });
  });

  it("does not leak another room's assignment into an unrelated room", () => {
    const result = resolveEffectiveHumanAccountability({
      workroomId: "WC-ALONE",
      rooms: [
        { workroomId: "WC-ALONE", accountablePrincipalIds: [] },
        { workroomId: "WC-ELSEWHERE", accountablePrincipalIds: ["PRN-OTHER-ORG"] },
      ],
      edges: [],
      organizationTopAccountablePrincipalId: OWNER,
    });
    expect(result).toMatchObject({ principalId: OWNER });
  });
});

describe("responsibility relation vocabulary", () => {
  it("only containment and spawning carry responsibility", () => {
    expect(isResponsibilityRelation("contains")).toBe(true);
    expect(isResponsibilityRelation("spawned-from")).toBe(true);
    expect(isResponsibilityRelation("depends-on")).toBe(false);
    expect(isResponsibilityRelation("blocks")).toBe(false);
    expect(isResponsibilityRelation("contributes-to")).toBe(false);
  });

  it("stays inside the canonical relation vocabulary", () => {
    expect(RESPONSIBILITY_RELATIONS_ARE_KNOWN).toBe(true);
  });
});

describe("describeAccountabilityProvenance", () => {
  const names: Record<string, string> = { "PRN-ALEX": "Alex", [OWNER]: "Robin" };
  const nameOf = (id: string) => names[id] ?? id;
  const roomOf = (id: string) => (id === "WC-FINANCE" ? "Finance" : id);

  it("names the room an inherited answer came from", () => {
    expect(describeAccountabilityProvenance(
      { state: "resolved", principalId: "PRN-ALEX", source: "inherited-room", inheritedFrom: ["WC-LEAF", "WC-FINANCE"] },
      nameOf, roomOf,
    )).toBe("Alex · inherited from Finance");
  });

  it("distinguishes an assignment here from the organization default", () => {
    expect(describeAccountabilityProvenance(
      { state: "resolved", principalId: "PRN-ALEX", source: "explicit-room", inheritedFrom: ["WC-1"] }, nameOf, roomOf,
    )).toBe("Alex · assigned here");
    expect(describeAccountabilityProvenance(
      { state: "resolved", principalId: OWNER, source: "organization-owner", inheritedFrom: [] }, nameOf, roomOf,
    )).toBe("Robin · organization owner");
  });

  it("surfaces the setup message rather than a name when nothing resolved", () => {
    expect(describeAccountabilityProvenance(
      { state: "setup-required", reason: "no-organization-owner-recorded", message: "Record the owner.", atWorkroomId: null },
      nameOf, roomOf,
    )).toBe("Record the owner.");
  });
});
