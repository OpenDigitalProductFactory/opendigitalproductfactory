// Ratified page-purpose contract for /workspace/ward (BI-F91D0685).
//
// A measured operating day found the rescue unable to answer two questions at
// any point: where is this animal, and how many kennels are free. This route
// answers those two and provides the shortest safe action path to correct them.

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
        "The shelter has configured kennel or foster-home resources, or an administrator is ready to add the first one.",
      ],
      job: "See every housing place, who is in it, what capacity is free, and place or release an animal.",
      successOutcome:
        "The worker can name an animal's housing, state the combined free capacity, and correct a placement without leaving the Ward.",
      findability: {
        parentArea: "Operations",
        entryPoints: ["/workspace", "Operations > Ward"],
        navigationLayer: "Workspace primary nav, Operations family",
        discoveryCue: "A 'Ward' item in the Operations family beside Calendar and Documents.",
        expectedPath: ["/workspace", "/workspace/ward"],
      },
      contentRoles: {
        defaultVisibleKeys: ["lead-summary", "open-ward-map", "place-or-move"],
        deferredRegions: [
          {
            key: "ward-list",
            role: "The same units as a table, adding area and state per row.",
            trigger: "Worker chooses List.",
          },
          {
            key: "housing-setup",
            role: "Create, pause, restore, or retire kennel and foster-home resources.",
            trigger: "Administrator opens Housing setup.",
          },
          {
            key: "release-current-stay",
            role: "Close a current stay while preserving its history.",
            trigger: "Administrator opens Release a current stay.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Speak the shelter's own words: wards, kennels, foster homes, housing, free. Never items, inventory, or slots.",
        actionLocation:
          "Map and list remain beside the occupancy count; routine placement is on the Ward and lower-frequency roster maintenance is disclosed below it.",
        feedbackPrimitive:
          "Shared form primitives announce pending, success, validation, permission, and conflict states; history-preserving release and retirement explain their consequence.",
        disclosurePattern:
          "Occupied of total and free lead the page, then the map and routine placement. Release and roster setup stay behind separate native disclosures.",
        returnBehavior: "The worker returns to Operations through the same workspace navigation family.",
      },
    },
    stateScenarios: {
      "housing-recorded": {
        statePredicate: "The organization has at least one active kennel or foster-home resource.",
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
          "Every housing resource shows its occupants or open capacity, and the combined free count matches the board.",
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
          "The shelter adds its first kennel or foster home in Housing setup; the page does not invent a roster.",
        recovery: {
          actionKey: "open-housing-setup",
          routePath: "/workspace/ward",
        },
      },
      "animals-without-a-unit": {
        statePredicate:
          "The organization holds animals in care that have no open housing stay.",
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
        "Find where an animal is staying, state the combined free capacity, and place an unplaced animal.",
      completionOracle:
        "The worker names the housing, states the free count, and receives settled confirmation after placing the animal.",
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
        "Routine placement remains visible; release and roster maintenance are progressively disclosed.",
        "Every mutating form announces pending and settled success or failure.",
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
