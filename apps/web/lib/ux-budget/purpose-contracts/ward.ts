// Ratified page-purpose contract for /workspace/ward (BI-F91D0685).
//
// A measured operating day found the rescue unable to answer two questions at
// any point: where is this animal, and how many kennels are free. This route
// exists to answer exactly those two and nothing else.

import type { PurposeContractModule } from ".";

export const WARD_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/workspace/ward",
    intent: {
      primaryUser:
        "A kennel technician or shelter manager walking the wards, often on a tablet held one-handed.",
      triggeringNeed:
        "Finding where an animal sleeps, and how much room is left, without asking a colleague or reading a whiteboard.",
      prerequisites: [
        "Signed in with access to the Operations family.",
        "The shelter has recorded its housing units as kennel resources.",
      ],
      job: "See every unit in the wards, who is in it, and which units are free.",
      successOutcome:
        "The worker can name the unit an animal is in, and say how many units are free, without counting rows.",
      findability: {
        parentArea: "Operations",
        entryPoints: ["/workspace", "Operations > Ward"],
        navigationLayer: "Workspace primary nav, Operations family",
        discoveryCue: "A 'Ward' item in the Operations family beside Calendar and Documents.",
        expectedPath: ["/workspace", "/workspace/ward"],
      },
      contentRoles: {
        defaultVisibleKeys: ["lead-summary", "open-ward-map"],
        deferredRegions: [
          {
            key: "ward-list",
            role: "The same units as a table, adding area and state per row.",
            trigger: "Worker chooses List.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Speak the shelter's own words: wards, kennels, units, free. Never items, inventory, or slots.",
        actionLocation:
          "The map and list views switch from one control beside the occupancy count; the page itself is read-only.",
        feedbackPrimitive:
          "Occupancy is read from the drawn units and a stated free count; there are no dialogs or destructive actions.",
        disclosurePattern:
          "Occupied of total and free lead the page, then the map. The list is one control away so reading grade and word budgets pass with workspace chrome included.",
        returnBehavior: "The worker returns to Operations through the same workspace navigation family.",
      },
    },
    stateScenarios: {
      "housing-recorded": {
        statePredicate: "The organization has at least one active kennel resource.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/ward/ward-store.ts#loadWardBoard",
        },
        essentialEvidenceKeys: ["occupied-of-total", "free-count", "unit-occupant"],
        primaryExperience: {
          kind: "informational",
          messageKey: "ward.housing-recorded",
        },
        prohibitedActionKeys: ["delete-kennel"],
        completionSignal:
          "Every unit shows either its occupant or that it is free, and the free count matches the units drawn as free.",
        errorCorrection:
          "A wrong occupant is corrected by moving the animal, which closes its stay rather than deleting the record.",
        recovery: {
          actionKey: "open-workspace",
          routePath: "/workspace",
        },
      },
      "no-housing-recorded": {
        statePredicate: "The organization has no active kennel resource.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/ward/ward-store.ts#loadWardBoard",
        },
        essentialEvidenceKeys: ["no-housing-notice"],
        primaryExperience: {
          kind: "informational",
          messageKey: "ward.no-housing-recorded",
        },
        prohibitedActionKeys: ["show-zero-free"],
        // A shelter that has told the system about no kennels has not answered
        // "none free". Rendering a confident zero would be the number a
        // capacity decision gets made on.
        completionSignal:
          "The page says no housing is recorded and does not state a free count at all.",
        errorCorrection:
          "The shelter records its kennels; the page does not invent a roster on its behalf.",
        recovery: {
          actionKey: "open-workspace",
          routePath: "/workspace",
        },
      },
      "animals-without-a-unit": {
        statePredicate:
          "The organization holds animals in care that have no open kennel stay.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/ward/ward-occupancy.ts#buildWardBoard",
        },
        essentialEvidenceKeys: ["unplaced-notice", "free-count"],
        primaryExperience: {
          kind: "informational",
          messageKey: "ward.animals-without-a-unit",
        },
        prohibitedActionKeys: ["hide-unplaced-animals"],
        completionSignal:
          "Every unplaced animal is named, and the page states that the free count is only true for the animals it can place.",
        errorCorrection:
          "The worker places the named animals, which is what makes the free count whole.",
        recovery: {
          actionKey: "open-workspace",
          routePath: "/workspace",
        },
      },
    },
    taskProtocol: {
      startRoute: "/workspace/ward",
      taskPrompt:
        "Find out where an animal is sleeping, and how many kennels are free.",
      completionOracle:
        "The worker names the unit an animal is in and states the free count, without counting rows and without asking a colleague.",
      falseSuccessConditions: [
        "A shelter that has recorded no kennels is shown a free count, which reads as a full or empty building it never reported.",
        "Animals in care with no kennel recorded are omitted, so the free count implies a completeness the board does not have.",
        "A unit held out of service for cleaning or repair is counted as free.",
        "A released stay still shows its animal, so an old occupant hides a free run.",
      ],
      acceptanceThresholds: [
        "Occupied-of-total and free are stated before the map.",
        "Every unit renders either its occupant or that it is free.",
        "Unplaced animals are named, with the free count qualified.",
        "The list flip carries the same units as the map and no fewer.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "BI-F91D0685",
    },
    reviewRef: "BI-F91D0685",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-E54F7F87",
        summary:
          "Owner, looking at the running portal: no notion of the pets currently in the shelter, and asked to know where they are, like a restaurant layout.",
      },
      {
        kind: "design-review",
        ref: "docs/superpowers/plans/2026-09-02-ward-board-housing-and-occupancy.md",
        summary:
          "The plan records the substrate verification behind this route and the four-phase order; the surface shape was scored through principle_decide DI-6E711DA68A9B against list-only and map-only.",
      },
    ],
  },
];
