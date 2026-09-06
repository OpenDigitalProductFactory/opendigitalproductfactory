// Standing Workroom derivation (BI-7E7B93DF).
//
// This is the ARCHETYPE layer of the proactive-Workroom demarcation
// (docs/superpowers/specs/2026-08-29-proactive-workrooms-design.md §4):
//
//   platform substrate  — the shape registry, the drive runner, the relations
//   archetype profile   — THIS FILE: which standing rooms a business of this
//                         kind needs, and how they nest under its portfolios
//   instance overlay    — which repository, which coworker, which threshold;
//                         configuration rows on the install, never code
//
// The rule this file must keep: it names KINDS of business work and never one
// business. No repository, forge account, person, supplier, credential or
// tuned threshold may appear here — those are instance facts, and a conformance
// test in standing-rooms.test.ts fails the build if one appears.
//
// Derived, never authored per install. The room set is a pure function of the
// archetype, so a new archetype inherits the whole universal set without anyone
// editing a table here. One gate — the source-operations rooms — keys on the
// archetype CATEGORY rather than an operating-model property, because no such
// property exists yet; the reasoning is recorded at that gate rather than
// papered over.

import type { ArchetypeDefinition, PortfolioRole } from "./types";

/**
 * A standing room a business of this archetype needs. `shapeKey` names a
 * declared work shape in the platform registry; this module deliberately holds
 * the key as a string rather than importing the platform module, so the
 * archetype layer never depends on the runtime layer.
 */
export interface StandingRoomDefinition {
  /** Stable key for the room itself, distinct from the shape that drives it. */
  key: string;
  label: string;
  portfolioRole: PortfolioRole;
  /** The declared work shape that gives this room its drive. Null on a group. */
  shapeKey: string | null;
  /** The containing room, expressing the `contains` relation. Null at the top. */
  parentKey: string | null;
  /** Why this room exists, in the operator's language. */
  purpose: string;
}

/** The five top rooms. Every business gets all five; what fills them varies. */
const SOURCE_CUSTODY = "source-custody-and-assurance";
const CONTRIBUTION_FLOW = "contribution-flow";
const ADOPTER_DESK = "adopter-and-inquiry-desk";
const CONTRIBUTOR_RELATIONS = "contributor-relations";
const BUSINESS_ADMINISTRATION = "business-administration";

const TOP_ROOMS: readonly StandingRoomDefinition[] = [
  {
    key: SOURCE_CUSTODY,
    label: "Source custody and assurance",
    // PAAW §6: security and governance are a reusable cross-product foundation.
    portfolioRole: "foundational",
    shapeKey: null,
    parentKey: null,
    purpose: "Keep what the business is built on safe, current, and governed.",
  },
  {
    key: CONTRIBUTION_FLOW,
    label: "Contribution flow",
    // PAAW §6 names CI/CD as a specialized production capability.
    portfolioRole: "manufactureAndDeliver",
    shapeKey: null,
    parentKey: null,
    purpose: "Move changes from proposal to release without anything stalling unseen.",
  },
  {
    key: ADOPTER_DESK,
    label: "Adopter and inquiry desk",
    portfolioRole: "productsAndServicesSold",
    shapeKey: null,
    parentKey: null,
    purpose: "Answer the people who ask, and notice the relationships that need attention.",
  },
  {
    key: CONTRIBUTOR_RELATIONS,
    label: "Contributor relations",
    // PAAW §6 places contributor capacity — and AI coworkers — here.
    portfolioRole: "forEmployees",
    shapeKey: null,
    parentKey: null,
    purpose: "Keep the people and AI coworkers who do the work qualified and accounted for.",
  },
  {
    key: BUSINESS_ADMINISTRATION,
    label: "Business administration",
    // Placement recorded as open for operator ratification in the design §5:
    // a support-portfolio reading of payables is defensible.
    portfolioRole: "foundational",
    shapeKey: null,
    parentKey: null,
    purpose: "Pay what is owed on time and know what each commitment costs.",
  },
];

/**
 * Rooms every business needs, whatever it sells: it holds credentials, answers
 * inquiries, carries relationships, pays bills, renews suppliers, and works
 * through people and AI coworkers.
 */
const UNIVERSAL_SUB_ROOMS: readonly StandingRoomDefinition[] = [
  {
    key: "credential-hygiene",
    label: "Credential hygiene",
    portfolioRole: "foundational",
    shapeKey: "credential-hygiene-watch",
    parentKey: SOURCE_CUSTODY,
    purpose: "Report how old every credential is, so none quietly outlives its safety.",
  },
  {
    key: "inquiry-response",
    label: "Inquiry response",
    portfolioRole: "productsAndServicesSold",
    shapeKey: "inquiry-response-watch",
    parentKey: ADOPTER_DESK,
    purpose: "Draft a grounded reply to everyone waiting; a person still sends it.",
  },
  {
    key: "adopter-health",
    label: "Adopter health",
    portfolioRole: "productsAndServicesSold",
    shapeKey: "adopter-health-watch",
    parentKey: ADOPTER_DESK,
    purpose: "Notice which relationships need attention before they go quiet.",
  },
  {
    key: "payables",
    label: "Payables",
    portfolioRole: "foundational",
    shapeKey: "payables-watch",
    parentKey: BUSINESS_ADMINISTRATION,
    purpose: "Report what falls due and what is not recorded at all; a person pays.",
  },
  {
    key: "vendor-renewal",
    label: "Vendor and subscription renewal",
    portfolioRole: "foundational",
    shapeKey: "vendor-renewal-watch",
    parentKey: BUSINESS_ADMINISTRATION,
    purpose: "Surface renewals before they auto-renew unnoticed.",
  },
  {
    key: "contributor-intake",
    label: "Contributor intake",
    portfolioRole: "forEmployees",
    shapeKey: "contributor-intake-watch",
    parentKey: CONTRIBUTOR_RELATIONS,
    purpose: "Keep the record of who contributes, and what is still missing from it.",
  },
  {
    key: "coworker-fitness",
    label: "Coworker fitness",
    portfolioRole: "forEmployees",
    shapeKey: "coworker-fitness-watch",
    parentKey: CONTRIBUTOR_RELATIONS,
    purpose: "Report which AI coworkers have gaps or stale qualifications.",
  },
];

/**
 * Rooms a business needs only when its product IS software it maintains in a
 * source repository.
 *
 * ⟦runtime: verified 2026-09-01⟧ The design proposed gating these on the
 * archetype's IT4IT `requirement-to-deploy` binding. That predicate is wrong
 * here and the codebase proves it: trades-maintenance, security-services,
 * real-estate-construction, media-production and professional-services already
 * declare `requirement-to-deploy` to mean "we design and build a deliverable
 * for a customer". Gating on it would hand a plumbing business a pull-request
 * room. No existing OVSM property distinguishes "builds software" from "builds
 * things", so this gates on the archetype CATEGORY — which is a kind of
 * business, squarely inside the archetype layer's remit, and is not an instance
 * fact. Adding the missing operating-model axis is follow-on work, not a reason
 * to fake a derivation that does not hold.
 */
const SOFTWARE_DELIVERY_SUB_ROOMS: readonly StandingRoomDefinition[] = [
  {
    key: "dependency-advisory-watch",
    label: "Dependency and advisory watch",
    portfolioRole: "foundational",
    shapeKey: "dependency-advisory-watch",
    parentKey: SOURCE_CUSTODY,
    purpose: "Catch published advisories that reach this estate, and hand over the decision.",
  },
  {
    key: "repository-policy-drift",
    label: "Repository policy drift",
    portfolioRole: "foundational",
    shapeKey: "repository-policy-drift-watch",
    parentKey: SOURCE_CUSTODY,
    purpose: "Notice when what is enforced stops matching what was agreed.",
  },
  {
    key: "pull-request-flow",
    label: "Pull-request flow",
    portfolioRole: "manufactureAndDeliver",
    shapeKey: "pull-request-flow-watch",
    parentKey: CONTRIBUTION_FLOW,
    purpose: "Say which proposed changes are stuck, and why; a person still merges.",
  },
  {
    key: "issue-triage",
    label: "Issue triage",
    portfolioRole: "manufactureAndDeliver",
    shapeKey: "issue-triage-watch",
    parentKey: CONTRIBUTION_FLOW,
    purpose: "Classify what comes in and propose the work; a person admits it.",
  },
  {
    key: "release-readiness",
    label: "Release readiness",
    portfolioRole: "manufactureAndDeliver",
    shapeKey: "release-readiness-watch",
    parentKey: CONTRIBUTION_FLOW,
    purpose: "Assemble the evidence a release needs and name what is missing.",
  },
];

/**
 * Archetype categories whose product is software kept in a source repository.
 * A category joins this set when its businesses genuinely run source
 * operations — never because one operator does.
 */
const SOURCE_OPERATING_CATEGORIES: ReadonlySet<string> = new Set(["software-platform"]);

/** True when this archetype's product is software it maintains in a repository. */
export function operatesASourceRepository(archetype: ArchetypeDefinition): boolean {
  return SOURCE_OPERATING_CATEGORIES.has(archetype.category);
}

/**
 * Pure derivation: archetype definition → the standing rooms it needs, nested
 * under the four portfolios. Deterministic and side-effect-free; safe to call
 * across every archetype in `ALL_ARCHETYPES`.
 */
export function deriveStandingRooms(
  archetype: ArchetypeDefinition,
): StandingRoomDefinition[] {
  const rooms: StandingRoomDefinition[] = [...TOP_ROOMS, ...UNIVERSAL_SUB_ROOMS];
  if (operatesASourceRepository(archetype)) rooms.push(...SOFTWARE_DELIVERY_SUB_ROOMS);
  return rooms;
}

/** The declared work-shape keys a given archetype will actually drive. */
export function standingRoomShapeKeys(archetype: ArchetypeDefinition): string[] {
  return deriveStandingRooms(archetype)
    .map((room) => room.shapeKey)
    .filter((key): key is string => key !== null);
}
