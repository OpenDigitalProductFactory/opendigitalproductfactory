/**
 * Bounded read projection for /workspace/rescue/intake (BI-7111AF0C).
 *
 * The queue shows completion and blockers, never unrestricted medical notes:
 * each animal carries its stage, hold, housing label, checklist progress and
 * the evaluator's stable blocker codes. Lists are capped; the page never loads
 * an organization's full record history.
 */

import { prisma } from "@dpf/db";

import { loadWardWorkspace, type WardStoreClient } from "@/lib/ward/ward-store";

import { ANIMAL_INTAKE_REQUIREMENTS, ANIMAL_SUBJECT_KIND, readAnimalIntakeRequirementSnapshot } from "./intake-policy";
import type { AnimalCustodyStage } from "./lifecycle";
import { evaluatePlacementReadiness, type PlacementBlocker } from "./placement-readiness";

export const INTAKE_QUEUE_LIMIT = 25;

export interface IntakeHousingOption {
  id: string;
  label: string;
  kindSlug: string;
  available: number;
}

export interface IntakeQueueEntry {
  animalProfileId: string;
  animalRef: string;
  name: string;
  species: string | null;
  episodeRef: string;
  version: number;
  stage: AnimalCustodyStage;
  intakeType: string;
  openedAt: string;
  holdActive: boolean;
  holdReason: string | null;
  housingLabel: string | null;
  checklist: { satisfied: number; total: number; missing: string[] };
  readiness: { ready: boolean; blockers: PlacementBlocker[] };
  group: "blocked" | "assessment" | "recovery" | "ready";
}

export interface IntakeWorkspace {
  entries: IntakeQueueEntry[];
  housing: IntakeHousingOption[];
  existingAnimals: Array<{ animalProfileId: string; name: string; animalRef: string }>;
  limit: number;
}

type Row = Record<string, unknown>;

export interface IntakeWorkspaceDb {
  animalCustodyEpisode: { findMany(args: unknown): Promise<Row[]> };
  careIntakePacket: { findMany(args: unknown): Promise<Row[]> };
  careIntakeException: { findMany(args: unknown): Promise<Row[]> };
  careRecord: { findMany(args: unknown): Promise<Row[]> };
  careAppointment: { findMany(args: unknown): Promise<Row[]> };
  resourceCapacityAllocation: { findMany(args: unknown): Promise<Row[]> };
  resource: { findMany(args: unknown): Promise<Row[]> };
  animalProfile: { findMany(args: unknown): Promise<Row[]> };
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $transaction<T>(work: (tx: IntakeWorkspaceDb) => Promise<T>): Promise<T>;
}

const STAGE_FROM_DB: Record<string, AnimalCustodyStage> = {
  intake: "intake",
  legal_hold: "legal-hold",
  quarantine: "quarantine",
  health_assessment: "health-assessment",
  procedures: "procedures",
  behavior_assessment: "behavior-assessment",
  care: "care",
  placement_ready: "placement-ready",
  outcome_recorded: "outcome-recorded",
};

function groupFor(entry: { holdActive: boolean; blockers: PlacementBlocker[]; ready: boolean }): IntakeQueueEntry["group"] {
  if (entry.ready) return "ready";
  if (entry.holdActive || entry.blockers.some((b) => b.code === "exception_open" || b.code === "housing_missing")) return "blocked";
  if (entry.blockers.some((b) => b.code === "recovery_active" || b.code === "appointment_blocking")) return "recovery";
  return "assessment";
}

export async function loadIntakeWorkspace(input: {
  organizationId: string;
  db?: IntakeWorkspaceDb;
  now?: Date;
}): Promise<IntakeWorkspace> {
  const db = input.db ?? (prisma as unknown as IntakeWorkspaceDb);
  const now = input.now ?? new Date();
  const { organizationId } = input;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true), set_config('app.patient_profile_ids', '', true)`;

    const [episodes, ward] = await Promise.all([
      tx.animalCustodyEpisode.findMany({
        where: { organizationId, closedAt: null, currentStage: { not: "placement_ready" } },
        orderBy: [{ openedAt: "asc" }, { id: "asc" }],
        take: INTAKE_QUEUE_LIMIT,
        select: {
          id: true, episodeRef: true, animalProfileId: true, currentStage: true, legalHoldActive: true, legalHoldReason: true,
          intakeType: true, openedAt: true, closedAt: true, version: true, organizationId: true,
          animal: { select: { animalRef: true, name: true, species: true } },
        },
      }),
      loadWardWorkspace({ organizationId, db: tx as unknown as WardStoreClient }),
    ]);

    const subjectRefs = episodes.map((e) => `${ANIMAL_SUBJECT_KIND}:${String(e.animalProfileId)}`);
    const animalRefs = episodes.map((e) => String((e.animal as Row).animalRef));
    const [packets, records, appointments, allocations] = subjectRefs.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          tx.careIntakePacket.findMany({
            where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: { in: subjectRefs }, status: { notIn: ["entered-in-error"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true, organizationId: true, subjectRef: true, status: true, requirementSnapshot: true },
          }),
          tx.careRecord.findMany({
            where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: { in: subjectRefs }, lifecycle: "active" },
            orderBy: { effectiveAt: "asc" },
            take: 2000,
            select: { id: true, organizationId: true, subjectRef: true, kind: true, lifecycle: true, effectiveAt: true, detail: true },
          }),
          tx.careAppointment.findMany({
            where: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, subjectRef: { in: subjectRefs }, enteredInErrorAt: null },
            take: 200,
            select: { id: true, subjectRef: true, status: true, footprintEnd: true },
          }),
          tx.resourceCapacityAllocation.findMany({
            where: { organizationId, demandSlug: "animal-occupancy", demandRef: { in: animalRefs }, releasedAt: null },
            select: { id: true, demandRef: true, resourceId: true, releasedAt: true },
          }),
        ]);
    const packetIds = packets.map((p) => String(p.id));
    const exceptions = packetIds.length === 0 ? [] : await tx.careIntakeException.findMany({
      where: { organizationId, packetId: { in: packetIds }, status: { in: ["open", "in-progress"] } },
      select: { id: true, packetId: true, summary: true },
    });

    const unitLabels = new Map<string, string>();
    for (const zone of ward.board?.zones ?? []) for (const unit of zone.units) unitLabels.set(unit.kennelId, unit.label);

    const entries: IntakeQueueEntry[] = episodes.map((episode) => {
      const animalProfileId = String(episode.animalProfileId);
      const subjectRef = `${ANIMAL_SUBJECT_KIND}:${animalProfileId}`;
      const animal = episode.animal as Row;
      const packet = packets.find((p) => String(p.subjectRef) === subjectRef) ?? null;
      const ownRecords = records.filter((r) => String(r.subjectRef) === subjectRef);
      const housing = allocations.filter((a) => String(a.demandRef) === String(animal.animalRef));
      const facts = {
        animalProfileId,
        organizationId,
        now,
        custody: { id: String(episode.id), animalProfileId, organizationId: String(episode.organizationId), currentStage: STAGE_FROM_DB[String(episode.currentStage)] ?? ("outcome-recorded" as AnimalCustodyStage), legalHoldActive: Boolean(episode.legalHoldActive), closedAt: (episode.closedAt as Date | null) ?? null },
        packet: packet ? { id: String(packet.id), organizationId: String(packet.organizationId), subjectRef: String(packet.subjectRef), status: String(packet.status), requirementSnapshot: packet.requirementSnapshot } : null,
        openExceptions: exceptions.filter((e) => packet && String(e.packetId) === String(packet.id)).map((e) => ({ id: String(e.id), summary: String(e.summary) })),
        careRecords: ownRecords.map((r) => ({ id: String(r.id), organizationId: String(r.organizationId), subjectRef: String(r.subjectRef), kind: String(r.kind), lifecycle: String(r.lifecycle), effectiveAt: r.effectiveAt as Date, detail: r.detail })),
        housing: housing.map((a) => ({ id: String(a.id), releasedAt: (a.releasedAt as Date | null) ?? null })),
        appointments: appointments.filter((a) => String(a.subjectRef) === subjectRef).map((a) => ({ id: String(a.id), status: String(a.status), footprintEnd: a.footprintEnd as Date })),
      };
      const readiness = evaluatePlacementReadiness(facts);
      let total = ANIMAL_INTAKE_REQUIREMENTS.filter((r) => r.required).length;
      try {
        if (packet) total = readAnimalIntakeRequirementSnapshot(packet.requirementSnapshot).requirements.filter((r) => r.required).length;
      } catch { /* unreadable snapshot is already a blocker */ }
      const missing = readiness.blockers.filter((b) => b.requirementKey).map((b) => b.requirementKey as string);
      const holdActive = Boolean(episode.legalHoldActive);
      return {
        animalProfileId,
        animalRef: String(animal.animalRef),
        name: String(animal.name),
        species: (animal.species as string | null) ?? null,
        episodeRef: String(episode.episodeRef),
        version: Number(episode.version),
        stage: facts.custody.currentStage,
        intakeType: String(episode.intakeType).replaceAll("_", "-"),
        openedAt: (episode.openedAt as Date).toISOString(),
        holdActive,
        holdReason: holdActive ? ((episode.legalHoldReason as string | null) ?? null) : null,
        housingLabel: housing[0] ? (unitLabels.get(String(housing[0].resourceId)) ?? "Housed") : null,
        checklist: { satisfied: readiness.satisfied.length, total, missing },
        readiness: { ready: readiness.ready, blockers: readiness.blockers },
        group: groupFor({ holdActive, blockers: readiness.blockers, ready: readiness.ready }),
      };
    });

    const order: Record<IntakeQueueEntry["group"], number> = { blocked: 0, assessment: 1, recovery: 2, ready: 3 };
    entries.sort((a, b) => order[a.group] - order[b.group] || a.openedAt.localeCompare(b.openedAt) || a.animalRef.localeCompare(b.animalRef));

    const housingOptions: IntakeHousingOption[] = [];
    for (const zone of ward.board?.zones ?? []) {
      for (const unit of zone.units) {
        if (unit.state === "out-of-service") continue;
        const available = unit.capacity - unit.occupants.length;
        if (available > 0) housingOptions.push({ id: unit.kennelId, label: unit.label, kindSlug: unit.kindSlug, available });
      }
    }
    housingOptions.sort((a, b) => a.label.localeCompare(b.label));

    const inQueue = new Set(entries.map((e) => e.animalRef));
    const existing = await tx.animalProfile.findMany({
      where: { organizationId, lifecycleStatus: { in: ["placed", "outcome_recorded", "inactive"] } },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
      select: { id: true, name: true, animalRef: true },
    });

    return {
      entries,
      housing: housingOptions,
      existingAnimals: existing.filter((a) => !inQueue.has(String(a.animalRef))).map((a) => ({ animalProfileId: String(a.id), name: String(a.name), animalRef: String(a.animalRef) })),
      limit: INTAKE_QUEUE_LIMIT,
    };
  });
}
