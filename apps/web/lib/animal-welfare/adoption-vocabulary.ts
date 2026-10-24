/** Client-safe adoption vocabulary and projection types (BI-A442F129). No database import. */

import type { AdoptionApplicationStatus } from "./adoption";

export const STAGE_LABEL: Record<AdoptionApplicationStatus, string> = {
  submitted: "Submitted",
  screening: "Screening",
  "meet-and-greet": "Meet and greet",
  "home-check": "Home check",
  approved: "Approved and reserved",
  waitlisted: "Waitlisted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  placed: "Placed",
  closed: "Closed",
};

/** The next stages an operator can choose from a given stage, with the facts each needs. */
export const NEXT_STAGES: Record<AdoptionApplicationStatus, Array<{ to: AdoptionApplicationStatus; needs: "none" | "reason" | "visit" }>> = {
  submitted: [{ to: "screening", needs: "none" }, { to: "withdrawn", needs: "reason" }],
  screening: [{ to: "meet-and-greet", needs: "visit" }, { to: "waitlisted", needs: "reason" }, { to: "declined", needs: "reason" }, { to: "withdrawn", needs: "reason" }],
  "meet-and-greet": [{ to: "home-check", needs: "visit" }, { to: "approved", needs: "none" }, { to: "declined", needs: "reason" }, { to: "withdrawn", needs: "reason" }],
  "home-check": [{ to: "approved", needs: "none" }, { to: "declined", needs: "reason" }, { to: "waitlisted", needs: "reason" }, { to: "withdrawn", needs: "reason" }],
  approved: [],
  waitlisted: [{ to: "screening", needs: "none" }, { to: "withdrawn", needs: "reason" }, { to: "closed", needs: "none" }],
  declined: [{ to: "closed", needs: "none" }],
  withdrawn: [{ to: "closed", needs: "none" }],
  placed: [],
  closed: [],
};

export interface AdoptionApplicationCard {
  applicationId: string;
  applicationRef: string;
  version: number;
  status: AdoptionApplicationStatus;
  applicantName: string;
  submittedAt: string;
  decisionReason: string | null;
  animalProfileId: string;
  animalName: string;
  animalRef: string;
  animalReady: boolean;
  animalOnHold: boolean;
  reservedForOther: string | null;
  reservation: { placementId: string; status: string } | null;
  nextVisitAt: string | null;
}

export interface ActivePlacementCard {
  placementId: string;
  version: number;
  animalName: string;
  animalRef: string;
  adopterName: string | null;
  placedAt: string | null;
}

export interface AdoptionWorkspace {
  applications: AdoptionApplicationCard[];
  placements: ActivePlacementCard[];
  animals: Array<{ animalProfileId: string; name: string; animalRef: string; ready: boolean }>;
  housing: Array<{ id: string; label: string; available: number }>;
  currency: string;
  limit: number;
}
