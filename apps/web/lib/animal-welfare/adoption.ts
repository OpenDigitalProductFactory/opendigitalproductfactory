import { openCustodyEpisode } from "./lifecycle";

export type AdoptionApplicationStatus =
  | "submitted" | "screening" | "meet-and-greet" | "home-check" | "approved"
  | "waitlisted" | "declined" | "withdrawn" | "placed" | "closed";

export type AnimalPlacementState = {
  animalProfileId: string;
  applicationId: string;
  status: "reserved" | "active" | "returned" | "cancelled";
  placedAt: Date;
  returnedAt: Date | null;
  returnReason: string | null;
};

const APPLICATION_TRANSITIONS: Record<AdoptionApplicationStatus, AdoptionApplicationStatus[]> = {
  submitted: ["screening", "withdrawn"],
  screening: ["meet-and-greet", "waitlisted", "declined", "withdrawn"],
  "meet-and-greet": ["home-check", "approved", "declined", "withdrawn"],
  "home-check": ["approved", "declined", "waitlisted", "withdrawn"],
  approved: ["placed", "closed"],
  waitlisted: ["screening", "withdrawn", "closed"],
  declined: ["closed"],
  withdrawn: ["closed"],
  placed: ["closed"],
  closed: [],
};

export function transitionAdoptionApplication(
  from: AdoptionApplicationStatus,
  to: AdoptionApplicationStatus,
): AdoptionApplicationStatus {
  if (!APPLICATION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid adoption application transition: ${from} -> ${to}`);
  }
  return to;
}

export function placeAnimal(input: {
  animalProfileId: string;
  applicationId: string;
  applicationStatus: AdoptionApplicationStatus;
  legalHoldActive: boolean;
  placedAt: Date;
}): AnimalPlacementState {
  if (input.applicationStatus !== "approved") throw new Error("Placement requires an approved application");
  if (input.legalHoldActive) throw new Error("An animal on legal hold cannot be placed");
  return {
    animalProfileId: input.animalProfileId,
    applicationId: input.applicationId,
    status: "active",
    placedAt: input.placedAt,
    returnedAt: null,
    returnReason: null,
  };
}

export function returnAnimal(
  placement: AnimalPlacementState,
  input: { returnedAt: Date; reason: string; organizationId: string; actorPrincipalId: string },
) {
  if (placement.status !== "active") throw new Error("Only an active placement can be returned");
  return {
    placement: { ...placement, status: "returned" as const, returnedAt: input.returnedAt, returnReason: input.reason },
    custodyEpisode: openCustodyEpisode({
      animalProfileId: placement.animalProfileId,
      organizationId: input.organizationId,
      intakeType: "return",
      occurredAt: input.returnedAt,
      actorPrincipalId: input.actorPrincipalId,
    }),
  };
}
