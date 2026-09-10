// Leaf-archetype marketing playbooks (EP-5CC9C184).
//
// Split from marketing-playbooks.ts so the category table and the leaf overrides
// grow independently — this table gains an entry each time an archetype's
// category answer turns out to be wrong for it, and the parent module was
// already at its complexity ceiling.

import type { MarketingPlaybook } from "./marketing-playbooks";

// ─── Leaf-Archetype Playbooks (most specific; beat the category) ───────────
//
// A category playbook answers for a whole industry. Some leaves are not served
// by their category's answer at all: a pet rescue sits in "nonprofit-community",
// whose playbook is donor-centric — its primaryGoal is growing a donor base, its
// stakeholders list has no adopters or fosters, and its CTAs are "Donate now".
// A rescue's job is PLACING ANIMALS, and marketing it as a fundraiser is the
// wrong job. This tier exists for that gap: a leaf overrides its category only
// where the category is genuinely wrong for it, not to restate the same advice.
export const LEAF_PLAYBOOKS: Record<string, MarketingPlaybook> = {
  "pet-rescue": {
    primaryGoal:
      "Place animals into the right permanent homes, and keep enough foster capacity to keep taking intakes",
    // A rescue serves a COMMUNITY, not customers. Donors matter, but they fund
    // the work rather than being the work — which is what the nonprofit-community
    // playbook gets backwards for this leaf.
    stakeholders:
      "Adopters, foster carers, volunteers, surrendering owners, donors, partner vets and shelters, local authorities",
    campaignTypes: [
      "Individual animal placement — one animal, its real history and needs",
      "Foster recruitment, especially before an expected intake wave",
      "Urgent capacity appeals when intake outpaces placement",
      "Longer-stay and harder-to-place animal features",
      "Post-adoption follow-up and returned-animal support",
      "Owner-surrender alternatives and keep-them-home support",
      "Volunteer recruitment (transport, fostering, events, admin)",
      "Donor and sponsor appeals tied to named, verifiable costs",
    ],
    contentTone:
      "Warm, plain and specific about the individual animal. Honest about behaviour, medical needs and unknowns — an adoption that fails because the listing oversold the animal costs the animal twice",
    keyMetrics: [
      "Adoptions completed",
      "Average length of stay before placement",
      "Return rate after adoption",
      "Active foster placements vs foster capacity",
      "Intake vs placement over the same window",
    ],
    ctaLanguage: [
      "Meet {name}",
      "Foster {name}",
      "Apply to adopt",
      "Offer a foster place",
      "Sponsor {name}'s care",
    ],
    agentSkills: [
      "Individual animal placement post",
      "Foster recruitment campaign",
      "Urgent capacity appeal",
      "Longer-stay animal feature",
    ],
    seedSegments: [
      {
        name: "Adopters",
        description:
          "Looking for a specific animal that fits their home, and needing honest information about behaviour, medical needs and unknowns before they commit.",
      },
      {
        name: "Foster carers",
        description:
          "Willing to hold an animal temporarily; the constraint is capacity and support, not goodwill. Recruiting them is what keeps intake possible.",
      },
      {
        name: "Volunteers",
        description:
          "Give time rather than money — transport, events, admin, kennel and yard work.",
      },
      {
        name: "Surrendering owners",
        description:
          "Considering giving up an animal. Often reachable with keep-them-home support instead, which prevents an intake the rescue would otherwise absorb.",
      },
      {
        name: "Donors and sponsors",
        description:
          "Fund the work rather than being the work. Respond to named, verifiable costs more than to general appeals.",
      },
    ],
    channelVehicles: [
      {
        channel: "Dedicated pet-adoption listing sites",
        purpose:
          "Primary placement route — reaches people already searching to adopt, which no general social channel does. The specific sites are regional; the operator names the ones their organization actually uses at onboarding.",
      },
      {
        channel: "Facebook Groups (local rescue, lost-and-found, breed-specific)",
        purpose:
          "Local placement and foster recruitment, and the workable route on Facebook given the Marketplace constraint below.",
      },
      {
        channel: "Partner shelters and veterinary practices",
        purpose: "Referral placement and surrender-alternative reach at the point people ask for help.",
      },
    ],
    channelConstraints: [
      {
        channel: "Facebook Marketplace",
        constraint: "Do not list animals for adoption, rehoming or sale.",
        rationale:
          "Meta's Commerce Policies prohibit the sale or transfer of animals on Marketplace, and rescue listings are removed under it. Posting there risks the listing and the page rather than reaching adopters.",
        insteadUse:
          "Facebook Groups, where local rescue and rehoming communities operate, and the dedicated adoption listing sites.",
      },
      {
        channel: "Any public listing",
        constraint:
          "Do not publish an animal as available while it is on hold, in assessment, or in a stray-hold period.",
        rationale:
          "A stray may still be reclaimed by its owner, and an animal under assessment has no settled behaviour profile yet. Publishing early produces applications the rescue must refuse and can cut across an owner's legal reclaim window.",
        insteadUse:
          "Publish once status is available; feature the animal as 'settling in' without an adoption CTA if visibility is wanted sooner.",
      },
    ],
  },
};


/** Leaf lookup, or null when the leaf has no override of its category. */
export function getPlaybookForLeafArchetype(
  archetypeId: string | null | undefined,
): MarketingPlaybook | null {
  return LEAF_PLAYBOOKS[archetypeId ?? ""] ?? null;
}
