/**
 * Bounded read projection for /workspace/rescue/adoptions (BI-A442F129).
 * The queue shows the applicant's name and stage only; screening answers are
 * confidential and stay out of the list.
 */

import { prisma } from "@dpf/db";

import { loadWardWorkspace, type WardStoreClient } from "@/lib/ward/ward-store";

import { applicationStatusFromDb, VISIT_ACTIVITY_KIND } from "./adoption-repository";
import { ANIMAL_SUBJECT_KIND } from "./intake-policy";
import type { AdoptionWorkspace } from "./adoption-vocabulary";

export const ADOPTION_QUEUE_LIMIT = 50;
const ACTIVE = ["submitted", "screening", "meet_and_greet", "home_check", "approved", "waitlisted"] as const;

export async function loadAdoptionWorkspace(input: { organizationId: string; currency: string; now?: Date }): Promise<AdoptionWorkspace> {
  const now = input.now ?? new Date();
  const { organizationId } = input;
  const [applications, placements, animals, ward, reservations] = await Promise.all([
    prisma.animalAdoptionApplication.findMany({
      where: { organizationId, status: { in: [...ACTIVE] } },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: ADOPTION_QUEUE_LIMIT,
      select: { id: true, applicationRef: true, version: true, status: true, applicantName: true, submittedAt: true, decisionReason: true, animalProfileId: true, placement: { select: { id: true, status: true } }, animal: { select: { name: true, animalRef: true, lifecycleStatus: true } } },
    }),
    prisma.animalPlacement.findMany({
      where: { organizationId, status: "active" },
      orderBy: [{ placedAt: "desc" }],
      take: ADOPTION_QUEUE_LIMIT,
      select: { id: true, version: true, placedAt: true, animal: { select: { name: true, animalRef: true } }, application: { select: { applicantName: true } } },
    }),
    prisma.animalProfile.findMany({
      where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } },
      orderBy: [{ name: "asc" }],
      take: 200,
      select: { id: true, name: true, animalRef: true, lifecycleStatus: true },
    }),
    loadWardWorkspace({ organizationId, db: prisma as unknown as WardStoreClient }),
    prisma.animalPlacement.findMany({
      where: { organizationId, status: { in: ["reserved", "active"] } },
      select: { animalProfileId: true, applicationId: true, application: { select: { applicantName: true } } },
    }),
  ]);
  const animalIds = applications.map((a) => a.animalProfileId);
  const [holds, visits] = await Promise.all([
    animalIds.length === 0 ? Promise.resolve([]) : prisma.animalCustodyEpisode.findMany({ where: { organizationId, animalProfileId: { in: animalIds }, closedAt: null, legalHoldActive: true }, select: { animalProfileId: true } }),
    applications.length === 0 ? Promise.resolve([]) : prisma.workEngagementActivity.findMany({
      where: { kind: VISIT_ACTIVITY_KIND, engagement: { organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, status: { in: ["planned", "in-progress"] }, dueAt: { gte: now } } },
      orderBy: { recordedAt: "desc" },
      take: 200,
      select: { payload: true, engagement: { select: { dueAt: true } } },
    }),
  ]);
  const onHold = new Set(holds.map((h) => h.animalProfileId));
  const nextVisit = new Map<string, string>();
  for (const v of visits) {
    const applicationId = (v.payload as { applicationId?: string } | null)?.applicationId;
    const due = v.engagement.dueAt?.toISOString();
    if (applicationId && due && (!nextVisit.has(applicationId) || due < nextVisit.get(applicationId)!)) nextVisit.set(applicationId, due);
  }
  const reservedBy = new Map<string, { applicationId: string; applicantName: string | null }>();
  for (const r of reservations) reservedBy.set(r.animalProfileId, { applicationId: r.applicationId, applicantName: r.application.applicantName });

  const housing: AdoptionWorkspace["housing"] = [];
  for (const zone of ward.board?.zones ?? []) for (const unit of zone.units) {
    if (unit.state === "out-of-service") continue;
    const available = unit.capacity - unit.occupants.length;
    if (available > 0) housing.push({ id: unit.kennelId, label: unit.label, available });
  }
  housing.sort((a, b) => a.label.localeCompare(b.label));

  return {
    applications: applications.map((a) => {
      const other = reservedBy.get(a.animalProfileId);
      return {
        applicationId: a.id,
        applicationRef: a.applicationRef,
        version: a.version,
        status: applicationStatusFromDb(a.status),
        applicantName: a.applicantName ?? "Applicant",
        submittedAt: a.submittedAt.toISOString(),
        decisionReason: a.decisionReason,
        animalProfileId: a.animalProfileId,
        animalName: a.animal.name,
        animalRef: a.animal.animalRef,
        animalReady: a.animal.lifecycleStatus === "placement_ready",
        animalOnHold: onHold.has(a.animalProfileId),
        reservedForOther: other && other.applicationId !== a.id ? (other.applicantName ?? "another applicant") : null,
        reservation: a.placement ? { placementId: a.placement.id, status: a.placement.status } : null,
        nextVisitAt: nextVisit.get(a.id) ?? null,
      };
    }),
    placements: placements.map((p) => ({ placementId: p.id, version: p.version, animalName: p.animal.name, animalRef: p.animal.animalRef, adopterName: p.application.applicantName, placedAt: p.placedAt?.toISOString() ?? null })),
    animals: animals.map((a) => ({ animalProfileId: a.id, name: a.name, animalRef: a.animalRef, ready: a.lifecycleStatus === "placement_ready" })),
    housing,
    currency: input.currency,
    limit: ADOPTION_QUEUE_LIMIT,
  };
}
