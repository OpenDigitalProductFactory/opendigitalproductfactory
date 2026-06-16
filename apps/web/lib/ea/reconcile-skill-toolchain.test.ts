import { describe, expect, it, vi } from "vitest";
import { reconcileSkillToolchain } from "./reconcile-skill-toolchain";

// Injected db only — no module mocks (avoids forks-pool bleed), mirroring the other
// reconcile tests. applySysmlModel is reached for real; a notation-null db makes it
// return "skipped", which is enough to prove the reconcile got past its skip guard and
// ran the assignment aggregation.
describe("reconcileSkillToolchain", () => {
  it("skips cleanly when no skills are seeded — no assignment query, no apply", async () => {
    const skillAssignment = { findMany: vi.fn() };
    const eaNotation = { findUnique: vi.fn() };
    const db = {
      skillDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      skillAssignment,
      eaNotation,
    };
    const r = await reconcileSkillToolchain({ db: db as never });
    expect(r.status).toBe("skipped");
    expect(skillAssignment.findMany).not.toHaveBeenCalled();
    expect(eaNotation.findUnique).not.toHaveBeenCalled();
  });

  it("aggregates enabled assignment counts and proceeds to apply when skills exist", async () => {
    const skillDefinition = {
      findMany: vi.fn().mockResolvedValue([
        {
          skillId: "a", name: "A", description: "d", category: "ops", status: "active",
          riskBand: "low", taskType: "conversation", capability: null,
          userInvocable: true, agentInvocable: true, allowedTools: [], composesFrom: [],
        },
      ]),
    };
    const skillAssignment = { findMany: vi.fn().mockResolvedValue([{ skillId: "a" }, { skillId: "a" }, { skillId: "z" }]) };
    const eaNotation = { findUnique: vi.fn().mockResolvedValue(null) }; // applySysmlModel → skipped
    const db = { skillDefinition, skillAssignment, eaNotation };

    const r = await reconcileSkillToolchain({ db: db as never });

    expect(skillAssignment.findMany).toHaveBeenCalledWith({ where: { enabled: true }, select: { skillId: true } });
    expect(eaNotation.findUnique).toHaveBeenCalledTimes(1); // got past the skip guard into applySysmlModel
    expect(r.status).toBe("skipped"); // only because this mock has no seeded notation
  });
});
