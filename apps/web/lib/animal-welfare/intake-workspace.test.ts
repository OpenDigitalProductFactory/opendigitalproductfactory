import { describe, expect, it, vi } from "vitest";

import { buildAnimalIntakeRequirementSnapshot } from "./intake-policy";
import { loadIntakeWorkspace, type IntakeWorkspaceDb } from "./intake-workspace";

const ORG = "org-1";
const NOW = new Date("2026-09-17T12:00:00Z");

function db(over: Partial<Record<string, unknown>> = {}): IntakeWorkspaceDb {
  const base = {
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(client)),
    animalCustodyEpisode: { findMany: vi.fn(async () => [
      { id: "ep-1", episodeRef: "CE-1", animalProfileId: "a1", currentStage: "legal_hold", legalHoldActive: true, legalHoldReason: "legal hold · ordinance", intakeType: "stray", openedAt: NOW, closedAt: null, version: 1, organizationId: ORG, animal: { animalRef: "AN-1", name: "Ranger", species: "dog" } },
      { id: "ep-2", episodeRef: "CE-2", animalProfileId: "a2", currentStage: "care", legalHoldActive: false, legalHoldReason: null, intakeType: "owner_relinquished", openedAt: new Date("2026-09-10T00:00:00Z"), closedAt: null, version: 3, organizationId: ORG, animal: { animalRef: "AN-2", name: "Saffron", species: "cat" } },
    ]) },
    careIntakePacket: { findMany: vi.fn(async () => [
      { id: "pk-1", organizationId: ORG, subjectRef: "animal-profile:a1", status: "in-progress", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() },
      { id: "pk-2", organizationId: ORG, subjectRef: "animal-profile:a2", status: "in-progress", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() },
    ]) },
    careIntakeException: { findMany: vi.fn(async () => []) },
    careRecord: { findMany: vi.fn(async () => [
      { id: "r1", organizationId: ORG, subjectRef: "animal-profile:a2", kind: "vaccination", lifecycle: "active", effectiveAt: NOW, detail: { requirementKey: "vaccination", product: "x", provider: "y" } },
    ]) },
    careAppointment: { findMany: vi.fn(async () => []) },
    resourceCapacityAllocation: { findMany: vi.fn(async (args: { where: { demandSlug?: string } }) => [
      { id: "al-2", resourceId: "k2", demandRef: "AN-2", startsAt: NOW, releasedAt: null },
    ]) },
    resource: { findMany: vi.fn(async () => [
      { id: "k1", label: "D1", kindSlug: "kennel", serviceArea: "Dog ward", capacity: 1, blockedReason: null, lifecycle: "active", version: 1 },
      { id: "k2", label: "D2", kindSlug: "kennel", serviceArea: "Dog ward", capacity: 1, blockedReason: null, lifecycle: "active", version: 1 },
      { id: "k3", label: "Out", kindSlug: "kennel", serviceArea: "Dog ward", capacity: 1, blockedReason: "flooded", lifecycle: "active", version: 1 },
    ]) },
    animalProfile: { findMany: vi.fn(async (args: { where: { lifecycleStatus?: unknown } }) =>
      JSON.stringify(args.where.lifecycleStatus).includes("placed")
        ? [{ id: "a9", name: "Old Timer", animalRef: "AN-9" }]
        : [{ animalRef: "AN-1", name: "Ranger", lifecycleStatus: "in_care" }, { animalRef: "AN-2", name: "Saffron", lifecycleStatus: "in_care" }]) },
  };
  const client = { ...base, ...over } as unknown as IntakeWorkspaceDb;
  return client;
}

describe("loadIntakeWorkspace", () => {
  it("projects each open admission with stage, hold, housing, checklist progress and blockers, blocked first", async () => {
    const workspace = await loadIntakeWorkspace({ organizationId: ORG, db: db(), now: NOW });
    expect(workspace.entries.map((e) => e.animalRef)).toEqual(["AN-1", "AN-2"]);
    const ranger = workspace.entries[0]!;
    expect(ranger).toMatchObject({ stage: "legal-hold", holdActive: true, holdReason: "legal hold · ordinance", housingLabel: null, group: "blocked", intakeType: "stray" });
    expect(ranger.readiness.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["hold_active", "housing_missing", "requirement_missing"]));
    const saffron = workspace.entries[1]!;
    expect(saffron).toMatchObject({ stage: "care", holdActive: false, housingLabel: "D2", group: "assessment" });
    expect(saffron.checklist).toMatchObject({ satisfied: 2, total: 8 });
    expect(saffron.checklist.missing).not.toContain("vaccination");
  });

  it("offers only open, in-service housing and returning animals not already in intake", async () => {
    const workspace = await loadIntakeWorkspace({ organizationId: ORG, db: db(), now: NOW });
    expect(workspace.housing).toEqual([{ id: "k1", label: "D1", kindSlug: "kennel", available: 1 }]);
    expect(workspace.existingAnimals).toEqual([{ animalProfileId: "a9", name: "Old Timer", animalRef: "AN-9" }]);
    expect(workspace.limit).toBe(25);
  });

  it("sets the animal-subject RLS context before reading", async () => {
    const client = db();
    await loadIntakeWorkspace({ organizationId: ORG, db: client, now: NOW });
    expect(client.$executeRaw).toHaveBeenCalled();
  });
});
