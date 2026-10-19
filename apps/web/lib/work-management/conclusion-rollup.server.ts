// BI-12A083B4 phase 2 — the read behind AC-CS-05.
//
// Composes what already exists: the objective's own posture derivation, the
// conclusion the drive already writes onto each room, and the organization's
// stated purpose. It adds no table and no second opinion — every judgement
// comes from `conclusion-rollup.ts`, which is pure and exhaustively walked.

import type { PrismaClient } from "@dpf/db";

import { deriveObjectivePosture } from "@/lib/product-management/outcomes";

import {
  resolveOutcomeRollup,
  type ObjectiveRollupInput,
  type OutcomeRollup,
  type RoomContribution,
} from "./conclusion-rollup";
import type { DriveConclusion } from "./drive-conclusion";

/**
 * How many observations to read per objective before deciding which is current.
 *
 * The stream is append-only and a correction supersedes exactly one row, so a
 * small window is enough to find the newest surviving observation. Bounded on
 * purpose: this read answers a question about an organization, and must not
 * become proportional to its entire measurement history.
 */
const OBSERVATION_WINDOW = 25;

/** Archived objectives are excluded at the query, not filtered afterwards. */
const ROLLED_UP_STATUSES = ["draft", "active", "closed"] as const;

type RollupDb = Pick<PrismaClient, "productObjective" | "productOutcomeObservation"
  | "productObjectiveWork" | "workroom" | "organization" | "businessContext">;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The conclusion the drive recorded on this room's last tick, or null.
 *
 * Null is returned for a room that has never been driven AND for one whose
 * snapshot predates phase 1. Both mean the same thing to a roll-up: this room
 * has concluded nothing, which the classifier treats as unconcluded rather than
 * as progress.
 */
export function readRoomConclusion(workspaceState: unknown): DriveConclusion | null {
  const drive = asRecord(asRecord(workspaceState)?.workroomDrive);
  const conclusion = asRecord(drive?.conclusion);
  if (!conclusion) return null;
  if (typeof conclusion.kind !== "string" || typeof conclusion.summary !== "string") return null;
  return conclusion as unknown as DriveConclusion;
}

/**
 * The newest observation that has not been superseded by a correction.
 *
 * A correction is a new row naming the one it replaces, so the superseded set
 * is read from the rows themselves rather than from a flag that could drift.
 */
export function currentObservation<T extends { id: string; supersedesObservationId: string | null }>(
  observations: readonly T[],
): T | null {
  const superseded = new Set(
    observations.map((entry) => entry.supersedesObservationId).filter((id): id is string => Boolean(id)),
  );
  return observations.find((entry) => !superseded.has(entry.id)) ?? null;
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Answer, for one organization, whether it is meeting the reason it exists —
 * and if not, what is blocking and who can clear it.
 */
export async function loadOutcomeRollup(
  db: RollupDb,
  input: { organizationId: string },
): Promise<OutcomeRollup> {
  const [organization, context, objectives] = await Promise.all([
    db.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, topAccountablePrincipalId: true },
    }),
    db.businessContext.findUnique({
      where: { organizationId: input.organizationId },
      select: { mission: true },
    }),
    db.productObjective.findMany({
      where: { organizationId: input.organizationId, status: { in: [...ROLLED_UP_STATUSES] } },
      orderBy: [{ reviewAt: "asc" }, { objectiveId: "asc" }],
      select: {
        id: true,
        objectiveId: true,
        title: true,
        status: true,
        measureKind: true,
        measureUnit: true,
        baselineValue: true,
        targetValue: true,
        targetNarrative: true,
      },
    }),
  ]);

  if (!organization) {
    throw new Error(`Unknown organization ${input.organizationId}; nothing can be rolled up to it.`);
  }

  const accountablePrincipalId = organization.topAccountablePrincipalId ?? null;
  // The same sentence the room-level lineage uses when it runs out of parents,
  // so an operator reading either level sees one wording for one defect.
  const accountableSetupRequired = accountablePrincipalId
    ? null
    : "This organization records no owner, so nothing can inherit accountability.";

  const inputs: ObjectiveRollupInput[] = [];
  for (const objective of objectives) {
    const [observations, links] = await Promise.all([
      db.productOutcomeObservation.findMany({
        where: { objectiveId: objective.id },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: OBSERVATION_WINDOW,
        select: {
          id: true,
          supersedesObservationId: true,
          numericValue: true,
          narrative: true,
          measureKind: true,
          measureUnit: true,
        },
      }),
      db.productObjectiveWork.findMany({
        where: { objectiveId: objective.id },
        select: { backlogItemId: true },
      }),
    ]);

    const latest = currentObservation(observations);
    const posture = deriveObjectivePosture({
      measureKind: objective.measureKind as never,
      measureUnit: objective.measureUnit,
      baselineValue: decimalToNumber(objective.baselineValue),
      targetValue: decimalToNumber(objective.targetValue),
      targetNarrative: objective.targetNarrative,
      latestObservation: latest
        ? {
          numericValue: decimalToNumber(latest.numericValue),
          narrative: latest.narrative,
          measureKind: latest.measureKind as never,
          measureUnit: latest.measureUnit,
        }
        : null,
    });

    const backlogItemIds = links.map((link) => link.backlogItemId);
    const rooms: RoomContribution[] = backlogItemIds.length === 0
      ? []
      : (await db.workroom.findMany({
        where: { backlogItemId: { in: backlogItemIds }, archivedAt: null },
        select: { capsuleId: true, workspaceState: true },
      })).map((room) => ({
        capsuleId: room.capsuleId,
        conclusion: readRoomConclusion(room.workspaceState),
      }));

    inputs.push({
      objectiveId: objective.objectiveId,
      title: objective.title,
      status: objective.status,
      posture,
      accountablePrincipalId,
      accountableSetupRequired,
      rooms,
    });
  }

  return resolveOutcomeRollup({
    organizationId: input.organizationId,
    mission: context?.mission ?? null,
    accountablePrincipalId,
    accountableSetupRequired,
    objectives: inputs,
  });
}
