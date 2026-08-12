// apps/web/lib/mcp/packs/coworker-find.test.ts
import { describe, it, expect } from "vitest";
import { matchCoworkers, type CoworkerRosterEntry } from "./coworker-pack";

const ROSTER: CoworkerRosterEntry[] = [
  {
    agentId: "AGT-EA",
    slugId: "ea-architect",
    displayName: "Enterprise Architect",
    description: "Reviews database schemas and system architecture.",
    role: "architect",
    kind: "advisor",
    skills: ["schema review", "architecture review"],
  },
  {
    agentId: "AGT-MKT",
    slugId: "marketing",
    displayName: "Marketing Lead",
    description: "Runs campaigns and channel strategy.",
    role: "marketing",
    kind: "specialist",
    skills: ["campaign ideas", "audience segmentation"],
  },
  {
    agentId: "AGT-FIN",
    slugId: "finance",
    displayName: "Finance Analyst",
    description: "Owns the general ledger and financial statements.",
    role: "finance",
    kind: "analyst",
    skills: ["journal entry", "variance analysis"],
  },
];

describe("find_coworker matchCoworkers (Slice 10, BI-5FB59BC6)", () => {
  it("matches by intent across description and skills", () => {
    const m = matchCoworkers(ROSTER, "review a database schema", 8);
    expect(m[0]?.agentId).toBe("AGT-EA");
    expect(m[0]?.matchedOn).toContain("description");
  });

  it("matches by role/name and weights them above description", () => {
    const m = matchCoworkers(ROSTER, "marketing", 8);
    expect(m[0]?.agentId).toBe("AGT-MKT");
    expect(m[0]?.matchedOn.some((f) => f === "role" || f === "name")).toBe(true);
  });

  it("returns nothing for a non-matching query", () => {
    expect(matchCoworkers(ROSTER, "zzz nonexistent", 8)).toEqual([]);
  });

  it("ignores 1-char noise terms and an empty query", () => {
    expect(matchCoworkers(ROSTER, "a", 8)).toEqual([]);
    expect(matchCoworkers(ROSTER, "   ", 8)).toEqual([]);
  });

  it("respects the limit", () => {
    // "review" hits EA (skills+description); broaden to hit multiple, then cap.
    const m = matchCoworkers(ROSTER, "review campaign ledger", 2);
    expect(m.length).toBeLessThanOrEqual(2);
  });

  it("projects only the allowlisted fields (no role/kind/skills leak)", () => {
    const m = matchCoworkers(ROSTER, "architecture", 8);
    expect(Object.keys(m[0] ?? {}).sort()).toEqual(
      ["agentId", "description", "displayName", "matchedOn", "slugId"].sort(),
    );
  });
});
