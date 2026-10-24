/**
 * The human half of the ward board.
 *
 * The board already says where an animal is and whether there is room. This
 * adds what a shelter worker actually carries around: what the animal looks
 * like, whether somebody is coming for them, and — only when the building is
 * full — who the shelter has to review.
 *
 * The client is narrowed to the calls actually made, so the projection can be
 * exercised without a database. Every read is scoped to one organization.
 */

import {
  summarizeAdoptionInterest,
  type AdoptionInterest,
  type ApplicationRow,
} from "./adoption-interest";
import { reviewCapacity, type TriageAnimal, type TriageReview } from "./capacity-triage";
import { isInCare } from "./ward-store";

/** Custody stages where the animal's picture is still incomplete. */
const ASSESSMENT_STAGES: ReadonlySet<string> = new Set([
  "quarantine",
  "health-assessment",
  "behavior-assessment",
  "procedures",
]);

const MS_PER_DAY = 86_400_000;

export function daysBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY));
}

interface AnimalRow {
  animalRef: string;
  name: string;
  status: string;
  primaryPhotoAssetId: string | null;
  animalProfileId: string | null;
}

interface EpisodeRow {
  animalProfileId: string;
  openedAt: Date;
  closedAt: Date | null;
  legalHoldActive: boolean;
  currentStage: string;
}

interface RawApplicationRow {
  animalProfileId: string;
  applicantName: string | null;
  status: string;
  submittedAt: Date;
}

type FindMany<T> = (args: unknown) => Promise<T[]>;

export interface CareContextClient {
  adoptableAnimal?: { findMany: FindMany<AnimalRow> };
  animalCustodyEpisode?: { findMany: FindMany<EpisodeRow> };
  animalAdoptionApplication?: { findMany: FindMany<RawApplicationRow> };
}

export interface WardCareContext {
  /** animalRef -> photo URL. Absent means no photograph was ever uploaded. */
  photos: Map<string, string>;
  /** animalRef -> the strongest live interest. */
  interest: Map<string, AdoptionInterest>;
  review: TriageReview;
}

/** The board is a picture of animals; a name in a box is not. */
export function photoUrl(assetId: string): string {
  return `/api/media/${assetId}`;
}

export async function loadWardCareContext(input: {
  organizationId: string;
  db: CareContextClient;
  freeUnits: number;
  now?: Date;
}): Promise<WardCareContext> {
  const { organizationId, db } = input;
  const now = input.now ?? new Date();
  const empty: WardCareContext = {
    photos: new Map(),
    interest: new Map(),
    review: reviewCapacity({ animals: [], freeUnits: input.freeUnits }),
  };
  if (!db.adoptableAnimal?.findMany) return empty;

  const animals = await db.adoptableAnimal.findMany({
    where: { organizationId },
    select: {
      animalRef: true,
      name: true,
      status: true,
      primaryPhotoAssetId: true,
      animalProfileId: true,
    },
  });

  const inCare = animals.filter((animal) => isInCare(animal.status));
  const profileIds = inCare
    .map((animal) => animal.animalProfileId)
    .filter((id): id is string => Boolean(id));

  const [episodes, rawApplications] = await Promise.all([
    db.animalCustodyEpisode?.findMany && profileIds.length > 0
      ? db.animalCustodyEpisode.findMany({
          where: { organizationId, animalProfileId: { in: profileIds } },
          select: {
            animalProfileId: true,
            openedAt: true,
            closedAt: true,
            legalHoldActive: true,
            currentStage: true,
          },
        })
      : Promise.resolve([] as EpisodeRow[]),
    db.animalAdoptionApplication?.findMany && profileIds.length > 0
      ? db.animalAdoptionApplication.findMany({
          where: { organizationId, animalProfileId: { in: profileIds } },
          select: {
            animalProfileId: true,
            applicantName: true,
            status: true,
            submittedAt: true,
          },
        })
      : Promise.resolve([] as RawApplicationRow[]),
  ]);

  const refByProfile = new Map(
    inCare
      .filter((animal) => animal.animalProfileId)
      .map((animal) => [animal.animalProfileId as string, animal.animalRef]),
  );

  const applications: ApplicationRow[] = rawApplications.flatMap((row) => {
    const animalRef = refByProfile.get(row.animalProfileId);
    if (!animalRef) return [];
    return [{
      animalProfileId: row.animalProfileId,
      animalRef,
      applicantName: row.applicantName,
      status: row.status,
      submittedAt: row.submittedAt,
    }];
  });
  const interest = summarizeAdoptionInterest(applications);

  // The open episode is the one that has not closed. A shelter that readmits an
  // animal starts a new episode, and time in care is time in THIS stay.
  const openEpisode = new Map<string, EpisodeRow>();
  for (const episode of episodes) {
    if (episode.closedAt) continue;
    const current = openEpisode.get(episode.animalProfileId);
    if (!current || episode.openedAt > current.openedAt) {
      openEpisode.set(episode.animalProfileId, episode);
    }
  }

  const triageAnimals: TriageAnimal[] = inCare.map((animal) => {
    const episode = animal.animalProfileId ? openEpisode.get(animal.animalProfileId) : undefined;
    return {
      animalRef: animal.animalRef,
      name: animal.name,
      daysInCare: episode ? daysBetween(episode.openedAt, now) : 0,
      legalHold: episode?.legalHoldActive ?? false,
      // No open episode means the shelter never recorded this stay. That is a
      // gap in the record, not a fact about the animal, so it is treated as
      // still being assessed rather than as a candidate.
      outcomeRecorded: false,
      underAssessment: episode ? ASSESSMENT_STAGES.has(episode.currentStage) : true,
      interest: interest.get(animal.animalRef),
    };
  });

  return {
    photos: new Map(
      inCare
        .filter((animal) => animal.primaryPhotoAssetId)
        .map((animal) => [animal.animalRef, photoUrl(animal.primaryPhotoAssetId as string)]),
    ),
    interest,
    review: reviewCapacity({ animals: triageAnimals, freeUnits: input.freeUnits }),
  };
}
