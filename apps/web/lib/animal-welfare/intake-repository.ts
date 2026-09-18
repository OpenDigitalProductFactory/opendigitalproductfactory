/**
 * Animal intake repository (BI-7111AF0C).
 *
 * One serializable transaction admits an animal: resolve or create the
 * organization-owned AnimalProfile, open the custody episode and append its
 * first event, freeze the intake checklist onto a subject-neutral
 * CareIntakePacket, and allocate compatible housing through the canonical
 * occupancy command. Any failure rolls the whole admission back, so a custody
 * episode without housing, or housing without custody, can never exist.
 *
 * Evidence, hold release and the placement-ready transition are separate
 * commands over the same canonical records. Every command derives tenancy and
 * the acting principal from the caller's authenticated context; the public
 * command shapes carry business facts only.
 */

import { randomUUID } from "node:crypto";

import {
  placeResourceOccupantWithin,
  type OccupancyResult,
  type OccupancyTransaction,
} from "@/lib/resource-scheduling/resource-occupancy";
import { newId } from "@/lib/shared/new-id";

import type { CareRecordKind } from "./care";
import {
  ANIMAL_SUBJECT_KIND,
  buildAnimalIntakeRequirementSnapshot,
  readAnimalIntakeRequirementSnapshot,
  validateAnimalEvidence,
  type AnimalIntakeRequirementKey,
} from "./intake-policy";
import type { AnimalCustodyStage, AnimalIntakeType } from "./lifecycle";
import { evaluatePlacementReadiness, type PlacementReadiness } from "./placement-readiness";

// ─── Client surface ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface IntakeTransaction extends OccupancyTransaction {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  animalProfile: {
    findFirst(args: unknown): Promise<(Row & { animalRef: string }) | null>;
    findUnique(args: unknown): Promise<Row | null>;
    create(args: unknown): Promise<Row>;
    update(args: unknown): Promise<Row>;
  };
  animalCustodyEpisode: {
    findFirst(args: unknown): Promise<Row | null>;
    findUnique(args: unknown): Promise<Row | null>;
    create(args: unknown): Promise<Row>;
    update(args: unknown): Promise<Row>;
    count(args: unknown): Promise<number>;
  };
  animalCustodyEvent: { create(args: unknown): Promise<Row> };
  careIntakePacket: {
    findFirst(args: unknown): Promise<Row | null>;
    create(args: unknown): Promise<Row>;
    update(args: unknown): Promise<Row>;
  };
  careIntakeStatusEvent: { create(args: unknown): Promise<Row> };
  careIntakeException: { findMany(args: unknown): Promise<Row[]> };
  careRecord: {
    findMany(args: unknown): Promise<Row[]>;
    create(args: unknown): Promise<Row>;
  };
  careAppointment: { findMany(args: unknown): Promise<Row[]> };
  resourceCapacityAllocation: OccupancyTransaction["resourceCapacityAllocation"] & {
    findMany(args: unknown): Promise<Row[]>;
  };
}

export interface IntakeClient {
  $transaction<T>(
    work: (transaction: IntakeTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export class IntakeCommandError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "animal_not_found"
      | "duplicate_identity"
      | "active_intake_exists"
      | "custody_not_found"
      | "hold_not_active"
      | "not_ready"
      | "stale_version"
      | "idempotency_conflict"
      | "capacity_unavailable"
      | "housing_incompatible"
      | "checklist_missing",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "IntakeCommandError";
  }
}

// ─── Command contracts ──────────────────────────────────────────────────────

export type AnimalIntakeCommand = {
  animal:
    | { mode: "existing"; animalProfileId: string }
    | {
        mode: "new";
        name: string;
        species: string;
        breed?: string | null;
        sex?: string | null;
        birthDate?: string | null;
        microchipNumber?: string | null;
      };
  intakeType: AnimalIntakeType;
  sourceName?: string | null;
  arrivedAt: string;
  initialHousingResourceId: string;
  hold?: { kind: "legal" | "policy"; source: string; reason: string; effectiveUntil?: string | null } | null;
  idempotencyKey: string;
};

/** Server-derived context. Never accepted from the caller. */
export interface IntakeContext {
  organizationId: string;
  storefrontId: string | null;
  actorPrincipalId: string;
  allowedHousingKinds: readonly string[];
  now?: Date;
}

export interface AnimalIntakeResult {
  animalProfileId: string;
  animalRef: string;
  custodyEpisodeId: string;
  episodeRef: string;
  packetId: string;
  housing: OccupancyResult;
  replayed: boolean;
}

const MAX_SERIALIZATION_ATTEMPTS = 3;
const PACKET_SOURCE_SYSTEM = "animal-intake";
const STAGE_MAP: Record<AnimalCustodyStage, string> = {
  intake: "intake",
  "legal-hold": "legal_hold",
  quarantine: "quarantine",
  "health-assessment": "health_assessment",
  procedures: "procedures",
  "behavior-assessment": "behavior_assessment",
  care: "care",
  "placement-ready": "placement_ready",
  "outcome-recorded": "outcome_recorded",
};
const STAGE_FROM_DB: Record<string, AnimalCustodyStage> = Object.fromEntries(
  Object.entries(STAGE_MAP).map(([k, v]) => [v, k as AnimalCustodyStage]),
);
const INTAKE_TYPE_MAP: Record<AnimalIntakeType, string> = {
  stray: "stray",
  "owner-relinquished": "owner_relinquished",
  "seizure-confiscate": "seizure_confiscate",
  "transfer-in": "transfer_in",
  "born-in-care": "born_in_care",
  return: "return",
  other: "other",
};

function isSerializationConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2034";
}

async function serializable<T>(db: IntakeClient, work: (tx: IntakeTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) throw error;
    }
  }
  throw new Error("unreachable");
}

/** The RLS session context the animal-subject policies read. */
async function setAnimalContext(tx: IntakeTransaction, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true), set_config('app.patient_profile_ids', '', true)`;
}

function subjectRef(animalProfileId: string): string {
  return `${ANIMAL_SUBJECT_KIND}:${animalProfileId}`;
}

function isoDate(value: string | null | undefined, field: string): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new IntakeCommandError("invalid_input", `${field} must be a valid date.`);
  return parsed;
}

async function lock(tx: IntakeTransaction, key: string): Promise<void> {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key);
}

// ─── Admission ──────────────────────────────────────────────────────────────

export async function recordAnimalIntake(input: {
  db: IntakeClient;
  context: IntakeContext;
  command: AnimalIntakeCommand;
}): Promise<AnimalIntakeResult> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  const arrivedAt = isoDate(command.arrivedAt, "Arrival") ?? now;
  if (!INTAKE_TYPE_MAP[command.intakeType]) throw new IntakeCommandError("invalid_input", "Choose a valid intake source.");
  if (!command.idempotencyKey?.trim()) throw new IntakeCommandError("invalid_input", "A retry key is required.");
  if (!command.initialHousingResourceId?.trim()) throw new IntakeCommandError("invalid_input", "Choose the housing the animal is going into.");
  if (command.hold && (!command.hold.source.trim() || !command.hold.reason.trim())) {
    throw new IntakeCommandError("invalid_input", "A hold needs its source and reason.");
  }
  const holdUntil = command.hold ? isoDate(command.hold.effectiveUntil, "Hold end") : null;
  if (command.animal.mode === "new" && (!command.animal.name.trim() || !command.animal.species.trim())) {
    throw new IntakeCommandError("invalid_input", "A new animal needs a name and species.");
  }

  return serializable(input.db, async (tx) => {
    await setAnimalContext(tx, context.organizationId);
    await lock(tx, `animal-intake:${context.organizationId}:${command.idempotencyKey}`);

    const replay = await tx.careIntakePacket.findFirst({
      where: { organizationId: context.organizationId, sourceSystem: PACKET_SOURCE_SYSTEM, sourceId: command.idempotencyKey },
      select: { id: true, subjectRef: true },
    });
    if (replay) {
      const animalProfileId = String(replay.subjectRef).slice(ANIMAL_SUBJECT_KIND.length + 1);
      const episode = await tx.animalCustodyEpisode.findFirst({
        where: { organizationId: context.organizationId, animalProfileId, closedAt: null },
        select: { id: true, episodeRef: true, animal: { select: { animalRef: true } } },
      });
      if (!episode) throw new IntakeCommandError("idempotency_conflict", "That retry key belongs to an intake that no longer has open custody.");
      const allocations = await tx.resourceCapacityAllocation.findMany({
        where: { organizationId: context.organizationId, demandRef: (episode.animal as Row).animalRef, releasedAt: null },
        select: { id: true, demandRef: true, resourceId: true, startsAt: true, releasedAt: true, releaseReason: true },
      });
      const allocation = allocations[0];
      if (!allocation) throw new IntakeCommandError("idempotency_conflict", "That retry key belongs to an intake whose housing was released.");
      return {
        animalProfileId,
        animalRef: String((episode.animal as Row).animalRef),
        custodyEpisodeId: String(episode.id),
        episodeRef: String(episode.episodeRef),
        packetId: String(replay.id),
        housing: {
          allocationId: String(allocation.id),
          animalRef: String(allocation.demandRef),
          resourceId: String(allocation.resourceId),
          placedAt: allocation.startsAt as Date,
          releasedAt: null,
          releaseReason: null,
          capacity: { occupied: 0, total: 0, available: 0 },
        },
        replayed: true,
      };
    }

    // 1. Identity.
    let animalProfileId: string;
    let animalRef: string;
    if (command.animal.mode === "existing") {
      const profile = await tx.animalProfile.findUnique({
        where: { id_organizationId: { id: command.animal.animalProfileId, organizationId: context.organizationId } },
        select: { id: true, animalRef: true },
      });
      if (!profile) throw new IntakeCommandError("animal_not_found", "That animal is not in this organization.");
      animalProfileId = String(profile.id);
      animalRef = String(profile.animalRef);
      await tx.animalProfile.update({
        where: { id: animalProfileId },
        data: { lifecycleStatus: "in_care", version: { increment: 1 } },
        select: { id: true },
      });
    } else {
      const chip = command.animal.microchipNumber?.trim() || null;
      if (chip) {
        const clash = await tx.animalProfile.findFirst({
          where: { organizationId: context.organizationId, microchipNumber: chip },
          select: { id: true, animalRef: true },
        });
        if (clash) {
          throw new IntakeCommandError("duplicate_identity", `Microchip ${chip} already belongs to ${clash.animalRef}. Record a return for that animal instead.`, { animalProfileId: clash.id });
        }
      }
      animalRef = `AN-${newId(8).toUpperCase()}`;
      const created = await tx.animalProfile.create({
        data: {
          animalRef,
          organizationId: context.organizationId,
          storefrontId: context.storefrontId,
          name: command.animal.name.trim(),
          species: command.animal.species.trim(),
          breed: command.animal.breed?.trim() || null,
          sex: command.animal.sex?.trim() || null,
          birthDate: isoDate(command.animal.birthDate, "Birth date"),
          microchipNumber: chip,
          lifecycleStatus: "in_care",
          source: "operator",
        },
        select: { id: true },
      });
      animalProfileId = String(created.id);
    }

    // 2. No conflicting open custody.
    const openCount = await tx.animalCustodyEpisode.count({
      where: { organizationId: context.organizationId, animalProfileId, closedAt: null },
    });
    if (openCount > 0) throw new IntakeCommandError("active_intake_exists", "This animal already has an open custody episode.");
    const priorEpisodes = await tx.animalCustodyEpisode.count({ where: { organizationId: context.organizationId, animalProfileId } });

    // 3. Custody episode + first event.
    const stage: AnimalCustodyStage = command.hold?.kind === "legal" ? "legal-hold" : "intake";
    const episode = await tx.animalCustodyEpisode.create({
      data: {
        episodeRef: `CE-${newId(10).toUpperCase()}`,
        organizationId: context.organizationId,
        animalProfileId,
        episodeNumber: priorEpisodes + 1,
        intakeType: INTAKE_TYPE_MAP[command.intakeType],
        intakeSource: command.sourceName?.trim() || null,
        openedAt: arrivedAt,
        currentStage: STAGE_MAP[stage],
        legalHoldActive: Boolean(command.hold),
        legalHoldReason: command.hold
          ? `${command.hold.kind} hold · ${command.hold.source.trim()} · ${command.hold.reason.trim()}${holdUntil ? ` · until ${holdUntil.toISOString()}` : ""}`
          : null,
      },
      select: { id: true, episodeRef: true },
    });
    await tx.animalCustodyEvent.create({
      data: {
        eventRef: `CEV-${newId(10).toUpperCase()}`,
        organizationId: context.organizationId,
        animalProfileId,
        custodyEpisodeId: episode.id,
        sequence: 1,
        fromStage: null,
        toStage: STAGE_MAP[stage],
        kind: "stage_transition",
        reason: `Admitted as ${command.intakeType}${command.sourceName ? ` from ${command.sourceName.trim()}` : ""}`,
        actorPrincipalRef: context.actorPrincipalId,
        occurredAt: arrivedAt,
      },
    });

    // 4. Intake checklist with the frozen requirement snapshot.
    const packet = await tx.careIntakePacket.create({
      data: {
        packetId: `animal-intake-${randomUUID()}`,
        organizationId: context.organizationId,
        subjectKindSlug: ANIMAL_SUBJECT_KIND,
        subjectRef: subjectRef(animalProfileId),
        status: "in-progress",
        sourceMode: "operator",
        purposeOfUse: "animal-intake",
        requirementSnapshot: buildAnimalIntakeRequirementSnapshot() as unknown as Row,
        startedAt: now,
        recordedByPrincipalId: context.actorPrincipalId,
        sourceSystem: PACKET_SOURCE_SYSTEM,
        sourceId: command.idempotencyKey,
        sensitivityLabels: ["animal-welfare"],
      },
      select: { id: true },
    });
    await tx.careIntakeStatusEvent.create({
      data: {
        eventId: `intake-event-${randomUUID()}`,
        organizationId: context.organizationId,
        packetId: packet.id,
        packetVersion: 1,
        fromStatus: null,
        toStatus: "in-progress",
        reason: "Animal admitted",
        sourceMode: "operator",
        actorPrincipalId: context.actorPrincipalId,
        occurredAt: now,
      },
    });

    // 5. Housing, inside the same transaction.
    let housing: OccupancyResult;
    try {
      housing = await placeResourceOccupantWithin(tx, {
        organizationId: context.organizationId,
        allowedKinds: context.allowedHousingKinds,
        command: {
          animalRef,
          destinationResourceId: command.initialHousingResourceId,
          placedAt: arrivedAt,
          idempotencyKey: `intake:${command.idempotencyKey}`,
        },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "resource_full") throw new IntakeCommandError("capacity_unavailable", "That housing is full. Choose another unit or release a stay first.", error);
      if (code === "resource_incompatible" || code === "resource_blocked" || code === "resource_not_found") {
        throw new IntakeCommandError("housing_incompatible", (error as Error).message, error);
      }
      throw error;
    }

    return {
      animalProfileId,
      animalRef,
      custodyEpisodeId: String(episode.id),
      episodeRef: String(episode.episodeRef),
      packetId: String(packet.id),
      housing,
      replayed: false,
    };
  });
}

// ─── Evidence ───────────────────────────────────────────────────────────────

export async function recordAnimalCareEvidence(input: {
  db: IntakeClient;
  context: Pick<IntakeContext, "organizationId" | "actorPrincipalId" | "now">;
  command: {
    animalProfileId: string;
    requirementKey: AnimalIntakeRequirementKey | string;
    kind: CareRecordKind;
    value?: string | null;
    unit?: string | null;
    effectiveAt?: string | null;
    detail: unknown;
  };
}): Promise<{ careRecordId: string; requirementKey: string }> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  const effectiveAt = isoDate(command.effectiveAt, "Effective date") ?? now;
  return serializable(input.db, async (tx) => {
    await setAnimalContext(tx, context.organizationId);
    const packet = await tx.careIntakePacket.findFirst({
      where: { organizationId: context.organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: subjectRef(command.animalProfileId), status: { in: ["assigned", "in-progress"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, requirementSnapshot: true },
    });
    if (!packet) throw new IntakeCommandError("checklist_missing", "This animal has no open intake checklist.");
    const snapshot = readAnimalIntakeRequirementSnapshot(packet.requirementSnapshot);
    let validated;
    try {
      validated = validateAnimalEvidence({ snapshot, requirementKey: command.requirementKey, kind: command.kind, value: command.value, unit: command.unit, detail: command.detail });
    } catch (error) {
      throw new IntakeCommandError("invalid_input", (error as Error).message, error);
    }
    const created = await tx.careRecord.create({
      data: {
        careRecordId: `care-${randomUUID()}`,
        organizationId: context.organizationId,
        subjectKindSlug: ANIMAL_SUBJECT_KIND,
        subjectRef: subjectRef(command.animalProfileId),
        kind: command.kind,
        display: validated.requirement.label,
        value: command.value?.trim() || null,
        unit: command.unit?.trim() || null,
        effectiveAt,
        detail: validated.detail as unknown as Row,
        source: "operator",
        authorPrincipalRef: context.actorPrincipalId,
        sensitivity: "confidential",
        recordedAt: now,
      },
      select: { id: true },
    });
    return { careRecordId: String(created.id), requirementKey: validated.requirement.key };
  });
}

// ─── Hold release and placement-ready ───────────────────────────────────────

async function loadOpenEpisode(tx: IntakeTransaction, organizationId: string, animalProfileId: string) {
  const episode = await tx.animalCustodyEpisode.findFirst({
    where: { organizationId, animalProfileId, closedAt: null },
    select: { id: true, animalProfileId: true, organizationId: true, currentStage: true, legalHoldActive: true, closedAt: true, version: true, animal: { select: { animalRef: true } } },
  });
  if (!episode) throw new IntakeCommandError("custody_not_found", "This animal has no open custody episode.");
  return episode;
}

export async function releaseAnimalHold(input: {
  db: IntakeClient;
  context: Pick<IntakeContext, "organizationId" | "actorPrincipalId" | "now">;
  command: { animalProfileId: string; expectedVersion: number; reason: string };
}): Promise<{ custodyEpisodeId: string; version: number }> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  if (!command.reason.trim()) throw new IntakeCommandError("invalid_input", "A hold release needs a reason.");
  return serializable(input.db, async (tx) => {
    await setAnimalContext(tx, context.organizationId);
    const episode = await loadOpenEpisode(tx, context.organizationId, command.animalProfileId);
    if (!episode.legalHoldActive) throw new IntakeCommandError("hold_not_active", "There is no active hold to release.");
    if (Number(episode.version) !== command.expectedVersion) throw new IntakeCommandError("stale_version", "This animal changed while you were looking. Reload and try again.");
    const version = Number(episode.version) + 1;
    const currentStage = String(episode.currentStage);
    const nextStage = currentStage === "legal_hold" ? "intake" : currentStage;
    await tx.animalCustodyEpisode.update({
      where: { id: episode.id },
      data: { legalHoldActive: false, currentStage: nextStage, version },
      select: { id: true },
    });
    await tx.animalCustodyEvent.create({
      data: {
        eventRef: `CEV-${newId(10).toUpperCase()}`,
        organizationId: context.organizationId,
        animalProfileId: command.animalProfileId,
        custodyEpisodeId: episode.id,
        sequence: version,
        fromStage: currentStage,
        toStage: nextStage,
        kind: "legal_hold_released",
        reason: command.reason.trim(),
        actorPrincipalRef: context.actorPrincipalId,
        occurredAt: now,
      },
    });
    return { custodyEpisodeId: String(episode.id), version };
  });
}

async function loadReadinessFacts(tx: IntakeTransaction, organizationId: string, animalProfileId: string, now: Date) {
  const ref = subjectRef(animalProfileId);
  const [episode, packet, records, appointments, animal] = await Promise.all([
    tx.animalCustodyEpisode.findFirst({
      where: { organizationId, animalProfileId, closedAt: null },
      select: { id: true, animalProfileId: true, organizationId: true, currentStage: true, legalHoldActive: true, closedAt: true, version: true },
    }),
    tx.careIntakePacket.findFirst({
      where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: ref, status: { notIn: ["entered-in-error"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, organizationId: true, subjectRef: true, status: true, requirementSnapshot: true },
    }),
    tx.careRecord.findMany({
      where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: ref },
      orderBy: { effectiveAt: "asc" },
      take: 500,
      select: { id: true, organizationId: true, subjectRef: true, kind: true, lifecycle: true, effectiveAt: true, detail: true },
    }),
    tx.careAppointment.findMany({
      where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: ref, enteredInErrorAt: null },
      take: 50,
      select: { id: true, status: true, footprintEnd: true },
    }),
    tx.animalProfile.findUnique({ where: { id: animalProfileId }, select: { animalRef: true, organizationId: true } }),
  ]);
  const exceptions = packet
    ? await tx.careIntakeException.findMany({ where: { organizationId, packetId: packet.id, status: { in: ["open", "in-progress"] } }, select: { id: true, summary: true } })
    : [];
  const housing = animal && String(animal.organizationId) === organizationId
    ? await tx.resourceCapacityAllocation.findMany({
        where: { organizationId, demandSlug: "animal-occupancy", demandRef: String(animal.animalRef), releasedAt: null },
        select: { id: true, releasedAt: true },
      })
    : [];
  const facts = {
    animalProfileId,
    organizationId,
    now,
    custody: episode
      ? { id: String(episode.id), animalProfileId: String(episode.animalProfileId), organizationId: String(episode.organizationId), currentStage: STAGE_FROM_DB[String(episode.currentStage)] ?? ("outcome-recorded" as AnimalCustodyStage), legalHoldActive: Boolean(episode.legalHoldActive), closedAt: (episode.closedAt as Date | null) ?? null }
      : null,
    packet: packet
      ? { id: String(packet.id), organizationId: String(packet.organizationId), subjectRef: String(packet.subjectRef), status: String(packet.status), requirementSnapshot: packet.requirementSnapshot }
      : null,
    openExceptions: exceptions.map((row) => ({ id: String(row.id), summary: String(row.summary) })),
    careRecords: records.map((row) => ({ id: String(row.id), organizationId: String(row.organizationId), subjectRef: String(row.subjectRef), kind: String(row.kind), lifecycle: String(row.lifecycle), effectiveAt: row.effectiveAt as Date, detail: row.detail })),
    housing: housing.map((row) => ({ id: String(row.id), releasedAt: (row.releasedAt as Date | null) ?? null })),
    appointments: appointments.map((row) => ({ id: String(row.id), status: String(row.status), footprintEnd: row.footprintEnd as Date })),
  };
  return { facts, episode, packet };
}

export async function evaluateAnimalPlacementReadiness(input: {
  db: IntakeClient;
  organizationId: string;
  animalProfileId: string;
  now?: Date;
}): Promise<PlacementReadiness> {
  return serializable(input.db, async (tx) => {
    await setAnimalContext(tx, input.organizationId);
    const { facts } = await loadReadinessFacts(tx, input.organizationId, input.animalProfileId, input.now ?? new Date());
    return evaluatePlacementReadiness(facts);
  });
}

/**
 * Locks the same facts the evaluator reads, re-runs it, and appends the
 * placement-ready custody event only on a ready verdict. No second readiness
 * flag is written anywhere.
 */
export async function markAnimalPlacementReady(input: {
  db: IntakeClient;
  context: Pick<IntakeContext, "organizationId" | "actorPrincipalId" | "now">;
  command: { animalProfileId: string; expectedVersion: number };
}): Promise<{ custodyEpisodeId: string; version: number; readiness: PlacementReadiness }> {
  const { context, command } = input;
  const now = context.now ?? new Date();
  return serializable(input.db, async (tx) => {
    await setAnimalContext(tx, context.organizationId);
    await lock(tx, `animal-custody:${context.organizationId}:${command.animalProfileId}`);
    const { facts, episode, packet } = await loadReadinessFacts(tx, context.organizationId, command.animalProfileId, now);
    if (!episode) throw new IntakeCommandError("custody_not_found", "This animal has no open custody episode.");
    if (Number(episode.version) !== command.expectedVersion) throw new IntakeCommandError("stale_version", "This animal changed while you were looking. Reload and try again.");
    const readiness = evaluatePlacementReadiness(facts);
    if (!readiness.ready) {
      throw new IntakeCommandError("not_ready", `Not ready: ${readiness.blockers.map((b) => b.message).join(" ")}`, readiness);
    }
    const version = Number(episode.version) + 1;
    await tx.animalCustodyEpisode.update({
      where: { id: episode.id },
      data: { currentStage: "placement_ready", version },
      select: { id: true },
    });
    await tx.animalCustodyEvent.create({
      data: {
        eventRef: `CEV-${newId(10).toUpperCase()}`,
        organizationId: context.organizationId,
        animalProfileId: command.animalProfileId,
        custodyEpisodeId: episode.id,
        sequence: version,
        fromStage: String(episode.currentStage),
        toStage: "placement_ready",
        kind: "stage_transition",
        reason: `Readiness verified: ${readiness.satisfied.map((s) => s.requirementKey).join(", ")}`,
        actorPrincipalRef: context.actorPrincipalId,
        occurredAt: now,
      },
    });
    await tx.animalProfile.update({ where: { id: command.animalProfileId }, data: { lifecycleStatus: "placement_ready", version: { increment: 1 } }, select: { id: true } });
    if (packet && String(packet.status) !== "completed") {
      await tx.careIntakePacket.update({ where: { id: packet.id }, data: { status: "completed", completedAt: now, completionPercent: 100, version: { increment: 1 } }, select: { id: true } });
    }
    return { custodyEpisodeId: String(episode.id), version, readiness };
  });
}
