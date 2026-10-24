/**
 * Capacity triage: which animals a full shelter should review first, and why.
 *
 * When a shelter runs out of room it has to decide who it can no longer hold.
 * Today that decision sits on one person, who then has to justify it — to the
 * team, to a board, and to themselves. The justification is the heaviest part,
 * and it is the part a machine can carry: this module states the criteria in
 * advance, applies them the same way every time, and shows its reasoning.
 *
 * What it does NOT do, and must never do:
 *   - decide anything. It ranks and explains; a person chooses.
 *   - record an outcome. `AnimalOutcomeType.euthanasia` exists and this module
 *     never writes it. Nothing here writes at all.
 *   - rank anybody it is not allowed to rank. The exclusions below are hard and
 *     are applied BEFORE scoring, so a protected animal cannot be out-scored
 *     onto the list by any combination of factors.
 *
 * Pure projection. Every input is already scoped to one organization.
 */

import type { AdoptionInterest } from "./adoption-interest";

export interface TriageAnimal {
  animalRef: string;
  name: string;
  /** Days since the current custody episode opened. */
  daysInCare: number;
  /** A court, police or statutory hold. The shelter is not free to decide. */
  legalHold: boolean;
  /** Set once an episode has closed with an outcome — already left care. */
  outcomeRecorded: boolean;
  /** Under veterinary or behavioural assessment: the picture is incomplete. */
  underAssessment: boolean;
  interest: AdoptionInterest | undefined;
}

export type ExclusionReason =
  | "legal-hold"
  | "adopter-coming"
  | "applicant-waiting"
  | "under-assessment"
  | "already-left-care";

export interface TriageExclusion {
  animalRef: string;
  name: string;
  reason: ExclusionReason;
  /** Said plainly, because a worker reads this to check the machine's work. */
  explanation: string;
}

export interface TriageCandidate {
  animalRef: string;
  name: string;
  daysInCare: number;
  /** Higher means "review this one sooner". Never a score of the animal. */
  weight: number;
  /** Every factor that contributed, in the words a person would use. */
  reasons: string[];
}

export interface TriageReview {
  /** True only when the shelter genuinely has no room. */
  underPressure: boolean;
  candidates: TriageCandidate[];
  excluded: TriageExclusion[];
  /** What a worker is being asked to do — never "confirm the machine". */
  ask: string;
}

/**
 * Hard exclusions, applied first. Order matters only for which explanation the
 * worker sees; any single one of these removes the animal entirely.
 */
function exclude(animal: TriageAnimal): TriageExclusion | null {
  const base = { animalRef: animal.animalRef, name: animal.name };
  if (animal.outcomeRecorded) {
    return { ...base, reason: "already-left-care", explanation: `${animal.name} has already left care.` };
  }
  if (animal.legalHold) {
    return {
      ...base,
      reason: "legal-hold",
      explanation: `${animal.name} is held under a legal hold. The shelter cannot decide this one.`,
    };
  }
  if (animal.interest?.level === "scheduled") {
    const who = animal.interest.applicantName;
    return {
      ...base,
      reason: "adopter-coming",
      explanation: who
        ? `${who} is coming for ${animal.name}.`
        : `${animal.name} has an approved adopter.`,
    };
  }
  if (animal.interest?.level === "interested") {
    return {
      ...base,
      reason: "applicant-waiting",
      explanation: `Someone has applied for ${animal.name} and has not been answered yet.`,
    };
  }
  if (animal.underAssessment) {
    return {
      ...base,
      reason: "under-assessment",
      explanation: `${animal.name} is still being assessed, so the picture is incomplete.`,
    };
  }
  return null;
}

/** Longest-waiting first, which is the criterion a shelter can defend out loud. */
function weigh(animal: TriageAnimal): TriageCandidate {
  const reasons: string[] = [];
  let weight = animal.daysInCare;

  reasons.push(
    animal.daysInCare === 1
      ? "In care 1 day."
      : `In care ${animal.daysInCare} days.`,
  );
  if (animal.daysInCare >= 90) {
    weight += 30;
    reasons.push("Longer than three months without a placement.");
  }
  reasons.push("No application, and no adopter waiting.");

  return {
    animalRef: animal.animalRef,
    name: animal.name,
    daysInCare: animal.daysInCare,
    weight,
    reasons,
  };
}

/**
 * Build the review.
 *
 * `freeUnits > 0` means there is still room, and a shelter with room has no
 * capacity decision to make — so no list is produced at all. The list appears
 * because the building is full, not because a screen has space for one.
 */
export function reviewCapacity(input: {
  animals: readonly TriageAnimal[];
  freeUnits: number;
  /** How many to put in front of a person at once. Small on purpose. */
  shortlist?: number;
}): TriageReview {
  const underPressure = input.freeUnits <= 0;
  const excluded: TriageExclusion[] = [];
  const eligible: TriageAnimal[] = [];

  for (const animal of input.animals) {
    const exclusion = exclude(animal);
    if (exclusion) excluded.push(exclusion);
    else eligible.push(animal);
  }

  if (!underPressure) {
    return {
      underPressure: false,
      candidates: [],
      excluded: [],
      ask: "There is still room. Nothing to review.",
    };
  }

  const candidates = eligible
    .map(weigh)
    .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name))
    .slice(0, input.shortlist ?? 3);

  return {
    underPressure: true,
    candidates,
    excluded,
    ask:
      candidates.length === 0
        ? "The shelter is full and every animal is protected from this review. Find room another way."
        : "The shelter is full. These have waited longest with nobody waiting for them. A person decides.",
  };
}
