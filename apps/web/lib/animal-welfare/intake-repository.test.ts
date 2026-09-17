import { describe, expect, it, vi } from "vitest";

import { buildAnimalIntakeRequirementSnapshot } from "./intake-policy";
import {
  IntakeCommandError,
  markAnimalPlacementReady,
  recordAnimalCareEvidence,
  recordAnimalIntake,
  releaseAnimalHold,
  type IntakeClient,
} from "./intake-repository";

const ORG = "org-1";
const CONTEXT = { organizationId: ORG, storefrontId: "sf-1", actorPrincipalId: "principal-1", allowedHousingKinds: ["kennel", "foster-home"], now: new Date("2026-09-17T12:00:00Z") };

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = () => vi.fn(async (_args?: any): Promise<Row[]> => []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = () => vi.fn(async (_args?: any): Promise<Row | null> => null);
const one = () => vi.fn(async (_args?: unknown): Promise<Row> => ({}));

function fixture() {
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    animalProfile: { findFirst: row(), findUnique: row(), create: one(), update: one() },
    adoptableAnimal: { findFirst: row() },
    animalCustodyEpisode: { findFirst: row(), findUnique: row(), create: one(), update: one(), count: vi.fn(async (_args?: unknown) => 0) },
    animalCustodyEvent: { create: one() },
    careIntakePacket: { findFirst: row(), create: one(), update: one() },
    careIntakeStatusEvent: { create: one() },
    careIntakeException: { findMany: rows() },
    careRecord: { findMany: rows(), create: one() },
    careAppointment: { findMany: rows() },
    resource: { findFirst: row() },
    resourceCapacityAllocation: { findFirst: row(), findMany: rows(), updateMany: one(), create: one() },
  };
  const db = { $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)) } as unknown as IntakeClient & { $transaction: ReturnType<typeof vi.fn> };
  // Defaults: fresh admission into an empty kennel.
  tx.careIntakePacket.findFirst.mockResolvedValue(null);
  tx.animalProfile.findFirst.mockResolvedValue(null);
  tx.animalProfile.create.mockResolvedValue({ id: "animal-new" });
  tx.animalCustodyEpisode.count.mockResolvedValue(0);
  tx.animalCustodyEpisode.create.mockResolvedValue({ id: "ep-1", episodeRef: "CE-1" });
  tx.careIntakePacket.create.mockResolvedValue({ id: "pk-1" });
  tx.resource.findFirst.mockResolvedValue({ id: "kennel-1", organizationId: ORG, domain: "care", kindSlug: "kennel", capacityUnit: "animals", capacity: 1, blockedReason: null, lifecycle: "active" });
  tx.resourceCapacityAllocation.findFirst.mockResolvedValue(null);
  tx.resourceCapacityAllocation.create.mockResolvedValue({ id: "alloc-1", demandRef: "AN-X", resourceId: "kennel-1", startsAt: CONTEXT.now, releasedAt: null, releaseReason: null });
  return { db, tx };
}

const NEW_DOG = { mode: "new" as const, name: "Ranger", species: "dog", microchipNumber: "981000000000001" };
const COMMAND = { animal: NEW_DOG, intakeType: "stray" as const, sourceName: "Found on Elm St", arrivedAt: "2026-09-17T11:00:00Z", initialHousingResourceId: "kennel-1", idempotencyKey: "req-1" };

describe("recordAnimalIntake", () => {
  it("admits a new stray: identity, custody, first event, checklist and housing in one transaction", async () => {
    const { db, tx } = fixture();
    // The housing command looks the profile up by animalRef after creation.
    tx.animalProfile.findFirst.mockImplementation(async (args: { where: { animalRef?: string } }) =>
      args.where.animalRef ? { animalRef: args.where.animalRef } : null);

    const result = await recordAnimalIntake({ db, context: CONTEXT, command: COMMAND });

    expect(result).toMatchObject({ animalProfileId: "animal-new", custodyEpisodeId: "ep-1", packetId: "pk-1", replayed: false });
    expect(result.animalRef).toMatch(/^AN-/);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(tx.$executeRaw).toHaveBeenCalled(); // RLS context
    expect(tx.animalProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, name: "Ranger", lifecycleStatus: "in_care", microchipNumber: "981000000000001" }) }));
    expect(tx.animalCustodyEpisode.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ episodeNumber: 1, intakeType: "stray", currentStage: "intake", legalHoldActive: false }) }));
    expect(tx.animalCustodyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sequence: 1, fromStage: null, toStage: "intake", actorPrincipalRef: "principal-1" }) }));
    const packet = (tx.careIntakePacket.create.mock.calls[0]![0] as { data: Row }).data;
    expect(packet).toMatchObject({ subjectKindSlug: "animal-profile", subjectRef: "animal-profile:animal-new", status: "in-progress", sourceSystem: "animal-intake", sourceId: "req-1" });
    expect(packet.requirementSnapshot).toEqual(buildAnimalIntakeRequirementSnapshot());
    expect(packet.patientProfileId).toBeUndefined();
    expect(tx.resourceCapacityAllocation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resourceId: "kennel-1", idempotencyKey: "intake:req-1" }) }));
  });

  it("opens a legal hold as its own stage and records the hold facts on the episode", async () => {
    const { db, tx } = fixture();
    tx.animalProfile.findFirst.mockImplementation(async (args: { where: { animalRef?: string } }) => args.where.animalRef ? { animalRef: args.where.animalRef } : null);
    await recordAnimalIntake({ db, context: CONTEXT, command: { ...COMMAND, hold: { kind: "legal", source: "County ordinance 12.4", reason: "Stray hold", effectiveUntil: "2026-09-22T00:00:00Z" } } });
    expect(tx.animalCustodyEpisode.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentStage: "legal_hold", legalHoldActive: true, legalHoldReason: expect.stringContaining("County ordinance 12.4") }) }));
  });

  it("refuses a duplicate microchip and never opens custody", async () => {
    const { db, tx } = fixture();
    tx.animalProfile.findFirst.mockResolvedValueOnce({ id: "animal-existing", animalRef: "AN-OLD" });
    await expect(recordAnimalIntake({ db, context: CONTEXT, command: COMMAND })).rejects.toMatchObject({ code: "duplicate_identity" });
    expect(tx.animalCustodyEpisode.create).not.toHaveBeenCalled();
  });

  it("refuses a second open custody episode for the same animal", async () => {
    const { db, tx } = fixture();
    tx.animalProfile.findUnique.mockResolvedValue({ id: "animal-1", animalRef: "AN-1" });
    tx.animalCustodyEpisode.count.mockResolvedValueOnce(1);
    await expect(recordAnimalIntake({ db, context: CONTEXT, command: { ...COMMAND, animal: { mode: "existing", animalProfileId: "animal-1" } } }))
      .rejects.toMatchObject({ code: "active_intake_exists" });
    expect(tx.careIntakePacket.create).not.toHaveBeenCalled();
  });

  it("maps a full kennel to capacity_unavailable so the whole admission rolls back", async () => {
    const { db, tx } = fixture();
    tx.animalProfile.findFirst.mockImplementation(async (args: { where: { animalRef?: string } }) => args.where.animalRef ? { animalRef: args.where.animalRef } : null);
    tx.resourceCapacityAllocation.findMany.mockImplementation(async (args: { where: { resourceId?: string } }) =>
      args.where.resourceId ? [{ id: "other", demandRef: "AN-OTHER", resourceId: "kennel-1", quantity: 1, releasedAt: null }] : []);
    await expect(recordAnimalIntake({ db, context: CONTEXT, command: COMMAND })).rejects.toMatchObject({ code: "capacity_unavailable" });
  });

  it("returns the authoritative intake on an idempotent retry without writing again", async () => {
    const { db, tx } = fixture();
    tx.careIntakePacket.findFirst.mockResolvedValueOnce({ id: "pk-1", subjectRef: "animal-profile:animal-new" });
    tx.animalCustodyEpisode.findFirst.mockResolvedValueOnce({ id: "ep-1", episodeRef: "CE-1", animal: { animalRef: "AN-X" } });
    tx.resourceCapacityAllocation.findMany.mockResolvedValueOnce([{ id: "alloc-1", demandRef: "AN-X", resourceId: "kennel-1", startsAt: CONTEXT.now, releasedAt: null, releaseReason: null }]);
    const result = await recordAnimalIntake({ db, context: CONTEXT, command: COMMAND });
    expect(result).toMatchObject({ replayed: true, packetId: "pk-1", custodyEpisodeId: "ep-1", animalRef: "AN-X" });
    expect(tx.animalProfile.create).not.toHaveBeenCalled();
    expect(tx.animalCustodyEpisode.create).not.toHaveBeenCalled();
  });

  it("validates business input before touching the database", async () => {
    const { db, tx } = fixture();
    await expect(recordAnimalIntake({ db, context: CONTEXT, command: { ...COMMAND, animal: { mode: "new", name: " ", species: "dog" } } })).rejects.toBeInstanceOf(IntakeCommandError);
    await expect(recordAnimalIntake({ db, context: CONTEXT, command: { ...COMMAND, hold: { kind: "policy", source: "", reason: "x" } } })).rejects.toMatchObject({ code: "invalid_input" });
    expect(tx.animalProfile.create).not.toHaveBeenCalled();
  });
});

describe("recordAnimalCareEvidence", () => {
  it("writes a typed care record against the open checklist", async () => {
    const { db, tx } = fixture();
    tx.careIntakePacket.findFirst.mockResolvedValueOnce({ id: "pk-1", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() });
    tx.careRecord.create.mockResolvedValueOnce({ id: "cr-1" });
    const result = await recordAnimalCareEvidence({ db, context: CONTEXT, command: { animalProfileId: "animal-1", requirementKey: "vaccination", kind: "vaccination", detail: { product: "DHPP", provider: "Dr Julia" } } });
    expect(result).toEqual({ careRecordId: "cr-1", requirementKey: "vaccination" });
    expect(tx.careRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subjectKindSlug: "animal-profile", subjectRef: "animal-profile:animal-1", kind: "vaccination", detail: expect.objectContaining({ requirementKey: "vaccination", product: "DHPP" }) }) }));
  });

  it("refuses evidence with no open checklist and rejects the legacy boolean", async () => {
    const { db, tx } = fixture();
    await expect(recordAnimalCareEvidence({ db, context: CONTEXT, command: { animalProfileId: "animal-1", requirementKey: "sterilization", kind: "procedure", detail: {} } })).rejects.toMatchObject({ code: "checklist_missing" });
    tx.careIntakePacket.findFirst.mockResolvedValueOnce({ id: "pk-1", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() });
    await expect(recordAnimalCareEvidence({ db, context: CONTEXT, command: { animalProfileId: "animal-1", requirementKey: "sterilization", kind: "procedure", detail: { spayed: true } } })).rejects.toMatchObject({ code: "invalid_input" });
    expect(tx.careRecord.create).not.toHaveBeenCalled();
  });
});

describe("releaseAnimalHold", () => {
  it("needs a reason, an active hold and the expected version, then appends the release event", async () => {
    const { db, tx } = fixture();
    tx.animalCustodyEpisode.findFirst.mockResolvedValue({ id: "ep-1", animalProfileId: "animal-1", organizationId: ORG, currentStage: "legal_hold", legalHoldActive: true, closedAt: null, version: 2, animal: { animalRef: "AN-1" } });
    await expect(releaseAnimalHold({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 2, reason: " " } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(releaseAnimalHold({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 1, reason: "Hold period elapsed" } })).rejects.toMatchObject({ code: "stale_version" });
    const result = await releaseAnimalHold({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 2, reason: "Hold period elapsed" } });
    expect(result).toEqual({ custodyEpisodeId: "ep-1", version: 3 });
    expect(tx.animalCustodyEpisode.update).toHaveBeenCalledWith(expect.objectContaining({ data: { legalHoldActive: false, currentStage: "intake", version: 3 } }));
    expect(tx.animalCustodyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "legal_hold_released", sequence: 3, reason: "Hold period elapsed" }) }));
  });
});

describe("markAnimalPlacementReady", () => {
  function readyFixture() {
    const { db, tx } = fixture();
    const subjectRef = "animal-profile:animal-1";
    tx.animalCustodyEpisode.findFirst.mockResolvedValue({ id: "ep-1", animalProfileId: "animal-1", organizationId: ORG, currentStage: "care", legalHoldActive: false, closedAt: null, version: 4 });
    tx.careIntakePacket.findFirst.mockResolvedValue({ id: "pk-1", organizationId: ORG, subjectRef, status: "in-progress", requirementSnapshot: buildAnimalIntakeRequirementSnapshot() });
    tx.animalProfile.findUnique.mockResolvedValue({ animalRef: "AN-1", organizationId: ORG });
    const rec = (id: string, kind: string, detail: Record<string, unknown>) => ({ id, organizationId: ORG, subjectRef, kind, lifecycle: "active", effectiveAt: new Date("2026-09-10T00:00:00Z"), detail });
    tx.careRecord.findMany.mockResolvedValue([
      rec("r1", "observation", { requirementKey: "identity-check", microchipScanned: true, provider: "Sam" }),
      rec("r2", "observation", { requirementKey: "intake-examination", provider: "Dr Julia", findings: "ok" }),
      rec("r3", "weight", { requirementKey: "weight-condition" }),
      rec("r4", "vaccination", { requirementKey: "vaccination", product: "DHPP", provider: "Dr Julia" }),
      rec("r5", "medication", { requirementKey: "parasite-treatment", product: "x", provider: "y", outcome: "given" }),
      rec("r6", "procedure", { requirementKey: "sterilization", provider: "Dr Julia", outcome: "completed", recoveryUntil: "2026-09-15T00:00:00Z" }),
      rec("r7", "behavior", { requirementKey: "behaviour-assessment", provider: "Sam", outcome: "friendly" }),
    ]);
    tx.resourceCapacityAllocation.findMany.mockResolvedValue([{ id: "alloc-1", releasedAt: null }]);
    return { db, tx };
  }

  it("transitions only on a ready verdict and completes the checklist", async () => {
    const { db, tx } = readyFixture();
    const result = await markAnimalPlacementReady({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 4 } });
    expect(result.readiness.ready).toBe(true);
    expect(result.version).toBe(5);
    expect(tx.animalCustodyEpisode.update).toHaveBeenCalledWith(expect.objectContaining({ data: { currentStage: "placement_ready", version: 5 } }));
    expect(tx.animalProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: "placement_ready" }) }));
    expect(tx.careIntakePacket.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }));
  });

  it("refuses with the evaluator's blockers and writes nothing when evidence is missing", async () => {
    const { db, tx } = readyFixture();
    tx.careRecord.findMany.mockResolvedValue([]);
    await expect(markAnimalPlacementReady({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 4 } }))
      .rejects.toMatchObject({ code: "not_ready", detail: expect.objectContaining({ ready: false }) });
    expect(tx.animalCustodyEpisode.update).not.toHaveBeenCalled();
    expect(tx.animalCustodyEvent.create).not.toHaveBeenCalled();
  });

  it("refuses a stale version before evaluating", async () => {
    const { db } = readyFixture();
    await expect(markAnimalPlacementReady({ db, context: CONTEXT, command: { animalProfileId: "animal-1", expectedVersion: 3 } })).rejects.toMatchObject({ code: "stale_version" });
  });
});
