/**
 * Adoption workflow (BI-A442F129, design 2026-08-25 §6.1 / plan Phase 5).
 *
 * The shelter's core transaction, on the canonical models that already exist:
 * AnimalAdoptionApplication carries the applicant and their screening answers
 * through the state machine in adoption.ts; AnimalPlacement is the exclusive
 * reservation and, once completed, the adoption record; the fee is a
 * StorefrontDonation toward that animal's care, never a price; a return closes
 * the placement and opens a new custody episode so history is never erased.
 * Meet-and-greet and home-check visits are dated subject-bound work items on
 * the same substrate daily care uses.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import { recordWorkEngagementActivity } from "@/lib/work-capture/work-engagement";
import { placeResourceOccupantWithin, type OccupancyTransaction } from "@/lib/resource-scheduling/resource-occupancy";
import { newId } from "@/lib/shared/new-id";

import { transitionAdoptionApplication, type AdoptionApplicationStatus } from "./adoption";
import { ANIMAL_SUBJECT_KIND } from "./intake-policy";

export const VISIT_ACTIVITY_KIND = "adoption-visit";
export const OCCUPANCY_DEMAND_SLUG = "animal-occupancy";

export class AdoptionCommandError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "animal_not_found"
      | "animal_not_ready"
      | "application_not_found"
      | "illegal_transition"
      | "already_reserved"
      | "placement_not_found"
      | "hold_active"
      | "stale_version"
      | "housing_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AdoptionCommandError";
  }
}

export interface AdoptionActor {
  userId: string;
  principalRef: string;
}

export interface AdoptionScreening {
  housing: string;
  otherPets: string;
  children: string;
  landlordPermission: "yes" | "no" | "not-applicable";
  experience: string;
}

const STATUS_TO_DB: Record<AdoptionApplicationStatus, string> = {
  submitted: "submitted",
  screening: "screening",
  "meet-and-greet": "meet_and_greet",
  "home-check": "home_check",
  approved: "approved",
  waitlisted: "waitlisted",
  declined: "declined",
  withdrawn: "withdrawn",
  placed: "placed",
  closed: "closed",
};
const STATUS_FROM_DB: Record<string, AdoptionApplicationStatus> = Object.fromEntries(
  Object.entries(STATUS_TO_DB).map(([k, v]) => [v, k as AdoptionApplicationStatus]),
);
export function applicationStatusFromDb(value: string): AdoptionApplicationStatus {
  return STATUS_FROM_DB[value] ?? (value as AdoptionApplicationStatus);
}

const REASON_REQUIRED: ReadonlySet<AdoptionApplicationStatus> = new Set(["declined", "waitlisted", "withdrawn"]);
const VISIT_STAGES: ReadonlySet<AdoptionApplicationStatus> = new Set(["meet-and-greet", "home-check"]);

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateScreening(input: unknown): AdoptionScreening {
  const s = (input ?? {}) as Record<string, unknown>;
  if (!text(s.housing) || !text(s.otherPets) || !text(s.children) || !text(s.experience)) {
    throw new AdoptionCommandError("invalid_input", "Screening needs the housing situation, other pets, children in the home, and experience.");
  }
  const landlord = s.landlordPermission;
  if (landlord !== "yes" && landlord !== "no" && landlord !== "not-applicable") {
    throw new AdoptionCommandError("invalid_input", "Say whether the landlord has given permission, or that it does not apply.");
  }
  return { housing: s.housing.trim(), otherPets: s.otherPets.trim(), children: s.children.trim(), landlordPermission: landlord, experience: s.experience.trim() };
}

async function serializable<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return (await prisma.$transaction(work as never, { isolationLevel: "Serializable" })) as T;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 3) throw error;
    }
  }
  throw new Error("unreachable");
}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] & OccupancyTransaction;

// ─── Application ────────────────────────────────────────────────────────────

export async function createAdoptionApplication(input: {
  organizationId: string;
  actor: AdoptionActor;
  command: { animalProfileId: string; applicantName: string; applicantContactRef?: string | null; inquiryRef?: string | null; screening: unknown };
  now?: Date;
}): Promise<{ applicationId: string; applicationRef: string }> {
  const now = input.now ?? new Date();
  if (!text(input.command.applicantName)) throw new AdoptionCommandError("invalid_input", "The applicant needs a name.");
  const screening = validateScreening(input.command.screening);
  return serializable(async (tx) => {
    const animal = await tx.animalProfile.findFirst({
      where: { id: input.command.animalProfileId, organizationId: input.organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } },
      select: { id: true, name: true },
    });
    if (!animal) throw new AdoptionCommandError("animal_not_found", "That animal is not in this organization's care.");
    const created = await tx.animalAdoptionApplication.create({
      data: {
        applicationRef: `AA-${newId(10).toUpperCase()}`,
        organizationId: input.organizationId,
        animalProfileId: animal.id,
        inquiryRef: input.command.inquiryRef?.trim() || null,
        applicantContactRef: input.command.applicantContactRef?.trim() || null,
        applicantName: input.command.applicantName.trim(),
        screening: screening as never,
        status: "submitted",
        reviewerPrincipalRef: input.actor.principalRef,
        submittedAt: now,
      },
      select: { id: true, applicationRef: true },
    });
    return { applicationId: created.id, applicationRef: created.applicationRef };
  });
}

/**
 * Move an application through the state machine. A visit stage needs a date
 * and creates dated work on the animal; declining, waitlisting or withdrawing
 * needs a reason; approving reserves the animal exclusively.
 */
export async function transitionAdoptionApplicationCommand(input: {
  organizationId: string;
  actor: AdoptionActor;
  command: { applicationId: string; to: AdoptionApplicationStatus; expectedVersion: number; reason?: string | null; visitAt?: string | null };
  now?: Date;
}): Promise<{ applicationId: string; status: AdoptionApplicationStatus; version: number; placementId: string | null; visitId: string | null }> {
  const now = input.now ?? new Date();
  const { command } = input;
  const reason = command.reason?.trim() || null;
  if (REASON_REQUIRED.has(command.to) && !reason) throw new AdoptionCommandError("invalid_input", "Give the applicant's reason so it can be read back later.");
  let visitAt: Date | null = null;
  if (VISIT_STAGES.has(command.to)) {
    visitAt = command.visitAt ? new Date(command.visitAt) : null;
    if (!visitAt || Number.isNaN(visitAt.getTime())) throw new AdoptionCommandError("invalid_input", "A visit needs a date and time.");
  }

  const result = await serializable(async (tx) => {
    const application = await tx.animalAdoptionApplication.findFirst({
      where: { id: command.applicationId, organizationId: input.organizationId },
      select: { id: true, status: true, version: true, applicantName: true, animalProfileId: true, animal: { select: { name: true, animalRef: true, lifecycleStatus: true } } },
    });
    if (!application) throw new AdoptionCommandError("application_not_found", "That application is not on this organization's list.");
    if (application.version !== command.expectedVersion) throw new AdoptionCommandError("stale_version", "This application changed while you were looking. Reload and try again.");
    const from = applicationStatusFromDb(application.status);
    let to: AdoptionApplicationStatus;
    try {
      to = transitionAdoptionApplication(from, command.to);
    } catch (error) {
      throw new AdoptionCommandError("illegal_transition", (error as Error).message);
    }

    let placementId: string | null = null;
    if (to === "approved") {
      if (application.animal.lifecycleStatus !== "placement_ready") {
        throw new AdoptionCommandError("animal_not_ready", `${application.animal.name} is not placement-ready yet. Finish the intake checklist first.`);
      }
      const episode = await tx.animalCustodyEpisode.findFirst({ where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId, closedAt: null }, select: { id: true, legalHoldActive: true } });
      if (!episode) throw new AdoptionCommandError("animal_not_ready", "This animal has no open custody episode.");
      if (episode.legalHoldActive) throw new AdoptionCommandError("hold_active", "A hold is active on this animal; it cannot be reserved.");
      const other = await tx.animalPlacement.findFirst({
        where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId, status: { in: ["reserved", "active"] } },
        select: { id: true, application: { select: { applicantName: true } } },
      });
      if (other) throw new AdoptionCommandError("already_reserved", `${application.animal.name} is already reserved for ${other.application.applicantName ?? "another applicant"}.`);
      const placement = await tx.animalPlacement.create({
        data: { placementRef: `PL-${newId(10).toUpperCase()}`, organizationId: input.organizationId, animalProfileId: application.animalProfileId, applicationId: application.id, status: "reserved" },
        select: { id: true },
      });
      placementId = placement.id;
      await tx.adoptableAnimal.updateMany({ where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId }, data: { status: "pending" } });
    }

    const version = application.version + 1;
    await tx.animalAdoptionApplication.update({
      where: { id: application.id },
      data: {
        status: STATUS_TO_DB[to] as never,
        version,
        reviewerPrincipalRef: input.actor.principalRef,
        ...(reason ? { decisionReason: reason } : {}),
        ...(to === "approved" || to === "declined" || to === "withdrawn" ? { decidedAt: now } : {}),
      },
      select: { id: true },
    });

    let visitId: string | null = null;
    if (visitAt) {
      const visit = await tx.workEngagement.create({
        data: {
          organizationId: input.organizationId,
          title: `${to === "meet-and-greet" ? "Meet and greet" : "Home check"}: ${application.animal.name} with ${application.applicantName ?? "applicant"}`,
          requestedOutcome: reason,
          subjectKindSlug: ANIMAL_SUBJECT_KIND,
          subjectRef: `${ANIMAL_SUBJECT_KIND}:${application.animalProfileId}`,
          dueAt: visitAt,
          status: "planned",
        },
        select: { id: true },
      });
      visitId = visit.id;
    }
    return { applicationId: application.id, status: to, version, placementId, visitId };
  });

  if (result.visitId) {
    await recordWorkEngagementActivity({
      engagementId: result.visitId,
      kind: VISIT_ACTIVITY_KIND,
      summary: `${command.to} scheduled`,
      payload: { applicationId: result.applicationId, stage: command.to, visitAt: visitAt?.toISOString() },
      actor: { userId: input.actor.userId },
    });
  }
  return result;
}

// ─── Placement, cancellation, return ────────────────────────────────────────

export async function completeAdoptionPlacement(input: {
  organizationId: string;
  storefrontId: string | null;
  actor: AdoptionActor;
  command: { applicationId: string; expectedVersion: number; placedAt?: string | null; fee?: { amount: number; currency: string; donorEmail: string } | null };
  now?: Date;
}): Promise<{ placementId: string; donationId: string | null }> {
  const now = input.now ?? new Date();
  const placedAt = input.command.placedAt ? new Date(input.command.placedAt) : now;
  if (Number.isNaN(placedAt.getTime())) throw new AdoptionCommandError("invalid_input", "Placement date must be a date.");
  const fee = input.command.fee;
  if (fee && (!Number.isFinite(fee.amount) || fee.amount <= 0 || !text(fee.donorEmail) || !text(fee.currency))) {
    throw new AdoptionCommandError("invalid_input", "An adoption fee is a donation: it needs an amount, currency and the adopter's email for the receipt.");
  }
  return serializable(async (tx) => {
    const application = await tx.animalAdoptionApplication.findFirst({
      where: { id: input.command.applicationId, organizationId: input.organizationId },
      select: { id: true, status: true, version: true, applicantName: true, applicantContactRef: true, animalProfileId: true, placement: { select: { id: true, status: true } }, animal: { select: { name: true, animalRef: true } } },
    });
    if (!application) throw new AdoptionCommandError("application_not_found", "That application is not on this organization's list.");
    if (application.version !== input.command.expectedVersion) throw new AdoptionCommandError("stale_version", "This application changed while you were looking. Reload and try again.");
    if (applicationStatusFromDb(application.status) !== "approved" || !application.placement || application.placement.status !== "reserved") {
      throw new AdoptionCommandError("illegal_transition", "Only an approved application with an active reservation can be completed.");
    }
    const episode = await tx.animalCustodyEpisode.findFirst({ where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId, closedAt: null }, select: { id: true, legalHoldActive: true, currentStage: true, version: true } });
    if (!episode) throw new AdoptionCommandError("animal_not_ready", "This animal has no open custody episode.");
    if (episode.legalHoldActive) throw new AdoptionCommandError("hold_active", "A hold is active on this animal; it cannot leave.");

    let donationId: string | null = null;
    if (fee) {
      if (!input.storefrontId) throw new AdoptionCommandError("invalid_input", "No storefront is configured to receive the adoption donation.");
      const donation = await tx.storefrontDonation.create({
        data: {
          donationRef: `DON-${newId(10).toUpperCase()}`,
          storefrontId: input.storefrontId,
          customerContactId: application.applicantContactRef,
          donorEmail: fee.donorEmail.trim(),
          donorName: application.applicantName,
          amount: fee.amount,
          currency: fee.currency.trim().toUpperCase(),
          message: `Adoption donation toward the care of ${application.animal.name} (${application.animal.animalRef})`,
          status: "pending",
        },
        select: { id: true },
      });
      donationId = donation.id;
    }

    await tx.animalPlacement.update({
      where: { id: application.placement.id },
      data: { status: "active", placedAt, adopterContactRef: application.applicantContactRef, adoptionFeeAmount: fee ? fee.amount : null, currency: fee ? fee.currency.trim().toUpperCase() : undefined, paymentRef: donationId, version: { increment: 1 } },
      select: { id: true },
    });
    await tx.animalAdoptionApplication.update({ where: { id: application.id }, data: { status: "placed", version: application.version + 1, reviewerPrincipalRef: input.actor.principalRef }, select: { id: true } });
    const episodeVersion = episode.version + 1;
    await tx.animalCustodyEpisode.update({ where: { id: episode.id }, data: { currentStage: "outcome_recorded", closedAt: placedAt, outcomeType: "adoption", outcomeReason: `Adopted by ${application.applicantName ?? "applicant"}`, version: episodeVersion }, select: { id: true } });
    await tx.animalCustodyEvent.create({
      data: { eventRef: `CEV-${newId(10).toUpperCase()}`, organizationId: input.organizationId, animalProfileId: application.animalProfileId, custodyEpisodeId: episode.id, sequence: episodeVersion, fromStage: episode.currentStage, toStage: "outcome_recorded", kind: "stage_transition", reason: "Adoption completed", actorPrincipalRef: input.actor.principalRef, occurredAt: placedAt },
    });
    await tx.animalProfile.update({ where: { id: application.animalProfileId }, data: { lifecycleStatus: "placed", version: { increment: 1 } }, select: { id: true } });
    await tx.adoptableAnimal.updateMany({ where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId }, data: { status: "adopted", adoptedAt: placedAt, publishedAt: null } });
    await tx.resourceCapacityAllocation.updateMany({
      where: { organizationId: input.organizationId, demandSlug: OCCUPANCY_DEMAND_SLUG, demandRef: application.animal.animalRef, releasedAt: null },
      data: { releasedAt: placedAt, releaseReason: "left-care" },
    });
    return { placementId: application.placement.id, donationId };
  });
}

export async function cancelAdoptionReservation(input: {
  organizationId: string;
  actor: AdoptionActor;
  command: { applicationId: string; expectedVersion: number; reason: string };
}): Promise<{ applicationId: string }> {
  if (!text(input.command.reason)) throw new AdoptionCommandError("invalid_input", "Say why the reservation is cancelled.");
  return serializable(async (tx) => {
    const application = await tx.animalAdoptionApplication.findFirst({
      where: { id: input.command.applicationId, organizationId: input.organizationId },
      select: { id: true, status: true, version: true, animalProfileId: true, placement: { select: { id: true, status: true } } },
    });
    if (!application) throw new AdoptionCommandError("application_not_found", "That application is not on this organization's list.");
    if (application.version !== input.command.expectedVersion) throw new AdoptionCommandError("stale_version", "This application changed while you were looking. Reload and try again.");
    if (!application.placement || application.placement.status !== "reserved") throw new AdoptionCommandError("illegal_transition", "There is no reservation to cancel.");
    await tx.animalPlacement.update({ where: { id: application.placement.id }, data: { status: "cancelled", returnReason: input.command.reason.trim(), version: { increment: 1 } }, select: { id: true } });
    await tx.animalAdoptionApplication.update({ where: { id: application.id }, data: { status: "closed", version: application.version + 1, decisionReason: input.command.reason.trim(), reviewerPrincipalRef: input.actor.principalRef }, select: { id: true } });
    await tx.adoptableAnimal.updateMany({ where: { organizationId: input.organizationId, animalProfileId: application.animalProfileId, status: "pending" }, data: { status: "available" } });
    return { applicationId: application.id };
  });
}

/** The organisation's defining promise: an adopted animal always comes back, with its history intact. */
export async function returnAdoptedAnimal(input: {
  organizationId: string;
  actor: AdoptionActor;
  allowedHousingKinds: readonly string[];
  command: { placementId: string; expectedVersion: number; reason: string; returnedAt?: string | null; housingResourceId?: string | null };
  now?: Date;
}): Promise<{ placementId: string; custodyEpisodeId: string; housed: boolean }> {
  const now = input.now ?? new Date();
  if (!text(input.command.reason)) throw new AdoptionCommandError("invalid_input", "Record why the animal is coming back; it is the most useful fact for the next placement.");
  const returnedAt = input.command.returnedAt ? new Date(input.command.returnedAt) : now;
  if (Number.isNaN(returnedAt.getTime())) throw new AdoptionCommandError("invalid_input", "Return date must be a date.");
  return serializable(async (tx) => {
    const placement = await tx.animalPlacement.findFirst({
      where: { id: input.command.placementId, organizationId: input.organizationId },
      select: { id: true, status: true, version: true, animalProfileId: true, animal: { select: { animalRef: true, name: true } } },
    });
    if (!placement) throw new AdoptionCommandError("placement_not_found", "That placement is not on this organization's list.");
    if (placement.version !== input.command.expectedVersion) throw new AdoptionCommandError("stale_version", "This placement changed while you were looking. Reload and try again.");
    if (placement.status !== "active") throw new AdoptionCommandError("illegal_transition", "Only an active placement can be returned.");
    await tx.animalPlacement.update({ where: { id: placement.id }, data: { status: "returned", returnedAt, returnReason: input.command.reason.trim(), version: { increment: 1 } }, select: { id: true } });
    const prior = await tx.animalCustodyEpisode.count({ where: { organizationId: input.organizationId, animalProfileId: placement.animalProfileId } });
    const episode = await tx.animalCustodyEpisode.create({
      data: { episodeRef: `CE-${newId(10).toUpperCase()}`, organizationId: input.organizationId, animalProfileId: placement.animalProfileId, episodeNumber: prior + 1, intakeType: "return", intakeSource: "Returned by adopter", openedAt: returnedAt, currentStage: "intake", legalHoldActive: false },
      select: { id: true },
    });
    await tx.animalCustodyEvent.create({
      data: { eventRef: `CEV-${newId(10).toUpperCase()}`, organizationId: input.organizationId, animalProfileId: placement.animalProfileId, custodyEpisodeId: episode.id, sequence: 1, fromStage: null, toStage: "intake", kind: "stage_transition", reason: `Returned: ${input.command.reason.trim()}`, actorPrincipalRef: input.actor.principalRef, occurredAt: returnedAt },
    });
    await tx.animalProfile.update({ where: { id: placement.animalProfileId }, data: { lifecycleStatus: "in_care", version: { increment: 1 } }, select: { id: true } });
    await tx.adoptableAnimal.updateMany({ where: { organizationId: input.organizationId, animalProfileId: placement.animalProfileId }, data: { status: "hold", adoptedAt: null } });
    let housed = false;
    if (input.command.housingResourceId) {
      try {
        await placeResourceOccupantWithin(tx, {
          organizationId: input.organizationId,
          allowedKinds: input.allowedHousingKinds,
          command: { animalRef: placement.animal.animalRef, destinationResourceId: input.command.housingResourceId, placedAt: returnedAt, idempotencyKey: `return:${placement.id}:${randomUUID()}` },
        });
        housed = true;
      } catch (error) {
        throw new AdoptionCommandError("housing_unavailable", (error as Error).message);
      }
    }
    return { placementId: placement.id, custodyEpisodeId: episode.id, housed };
  });
}
