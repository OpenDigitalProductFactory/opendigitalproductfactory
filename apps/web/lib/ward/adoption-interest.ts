/**
 * Who is coming for this animal.
 *
 * The ward board answers where an animal is and whether there is room. It said
 * nothing about the thing the work is actually for: that somebody is on their
 * way to take this one home. A kennel with a person attached to it is not the
 * same as a full kennel, and a shelter under pressure has to be able to see the
 * difference at a glance.
 *
 * Pure projection over `AnimalAdoptionApplication`. Nothing here reads or writes.
 */

/** Application states the platform already models. */
export type ApplicationStatus =
  | "submitted"
  | "screening"
  | "meet-and-greet"
  | "home-check"
  | "approved"
  | "waitlisted"
  | "declined"
  | "withdrawn"
  | "placed";

export interface ApplicationRow {
  animalProfileId: string;
  animalRef: string;
  applicantName: string | null;
  status: string;
  submittedAt: Date;
}

/**
 * `scheduled` — a person is committed and a date is effectively in play.
 * `interested` — an application exists but nobody has met the animal yet.
 *
 * The split matters because only the first is a promise to a person. Treating a
 * fresh enquiry as a scheduled adoption would put a happy badge on a kennel that
 * has nothing behind it.
 */
export type AdoptionInterestLevel = "scheduled" | "interested";

const SCHEDULED: ReadonlySet<string> = new Set(["approved", "home-check", "meet-and-greet"]);
const INTERESTED: ReadonlySet<string> = new Set(["submitted", "screening"]);

/** `placed` is already an outcome; declined/withdrawn/waitlisted are not someone coming. */
export function classifyApplication(status: string): AdoptionInterestLevel | null {
  const key = (status ?? "").trim().toLowerCase();
  if (SCHEDULED.has(key)) return "scheduled";
  if (INTERESTED.has(key)) return "interested";
  return null;
}

export interface AdoptionInterest {
  level: AdoptionInterestLevel;
  /** Named when the shelter recorded a name; a person, not a row id. */
  applicantName: string | null;
  since: Date;
}

/**
 * Strongest live interest per animal. An animal with both a fresh enquiry and an
 * approved applicant is "scheduled" — the better news wins, because that is the
 * one a worker needs to act on and the one that must never be missed.
 */
export function summarizeAdoptionInterest(
  applications: readonly ApplicationRow[],
): Map<string, AdoptionInterest> {
  const byAnimal = new Map<string, AdoptionInterest>();

  for (const application of applications) {
    const level = classifyApplication(application.status);
    if (!level) continue;

    const current = byAnimal.get(application.animalRef);
    const beats =
      current == null
      || (current.level === "interested" && level === "scheduled")
      // Same level: the earliest applicant has been waiting longest.
      || (current.level === level && application.submittedAt < current.since);
    if (!beats) continue;

    byAnimal.set(application.animalRef, {
      level,
      applicantName: application.applicantName?.trim() || null,
      since: application.submittedAt,
    });
  }

  return byAnimal;
}

/** One short line a worker can read from across the room. */
export function describeInterest(interest: AdoptionInterest | undefined): string | null {
  if (!interest) return null;
  const who = interest.applicantName;
  if (interest.level === "scheduled") {
    return who ? `${who} is coming for them` : "Adopter approved";
  }
  return who ? `${who} has applied` : "Someone has applied";
}
