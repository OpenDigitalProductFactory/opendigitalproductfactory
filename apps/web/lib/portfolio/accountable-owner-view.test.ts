import { describe, expect, it } from "vitest";

import { projectPortfolioOwnership } from "./accountable-owner-view";

describe("projectPortfolioOwnership (BI-67B27832 AC-5)", () => {
  it("shows each portfolio's accountable person, and an unset one as unset", () => {
    const view = projectPortfolioOwnership(
      [
        { id: "b", slug: "foundational", name: "Foundational", accountableSetAt: new Date("2026-09-29T20:00:00Z"), accountableReason: "Runs the platform", accountablePrincipal: { principalId: "PRN-mark", displayName: "Mark" } },
        { id: "a", slug: "for_employees", name: "Workforce", accountableSetAt: null, accountableReason: null, accountablePrincipal: null },
      ],
      [{ principalId: "PRN-mark", displayName: "Mark", email: "mark@example.com" }],
      { email: "admin@dpf.local", source: "fallback" },
    );
    expect(view.rows.map((r) => [r.name, r.owner?.displayName ?? null])).toEqual([["Foundational", "Mark"], ["Workforce", null]]);
    expect(view.rows[0]).toMatchObject({ setAt: "2026-09-29T20:00:00.000Z", reason: "Runs the platform" });
    expect(view.standIn).toEqual({ email: "admin@dpf.local", source: "fallback" });
  });
});
