// Ratified page-purpose contract for /storefront/animals/waiting (BI-899D7F00).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so the
// adoption waiting list arrives ratified. Shape mirrors mileage.ts.
//
// This is the page the owner asked for five times across three days
// (BI-5C3F3433, BI-336EEDF3, BI-C3B5FB75, BI-3A0F6E1F, all retired onto
// BI-899D7F00) while Build Studio escalated and the item vanished. The decided
// scope in the request is honoured verbatim: staff-only, no pagination, cap at
// the 100 longest-waiting and say so, future dates left out of the ordering,
// missing dates shown last, read-only over the stored listing date.

import type { PurposeContractModule } from ".";

export const ADOPTION_WAITING_LIST_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/storefront/animals/waiting",
    intent: {
      primaryUser:
        "A rescue's owner or staff member putting together the newsletter, choosing which animals to feature.",
      triggeringNeed:
        "Knowing which listed animals have waited longest, without scrolling the admin list and doing date arithmetic by hand.",
      prerequisites: [
        "Signed in with a staff account that can view the storefront.",
        "A storefront exists and animals have been listed on the Animals page.",
      ],
      job: "Read every animal currently listed for adoption, longest wait first, with the whole days each has waited.",
      successOutcome:
        "The reader sees the full list in wait order on one page, spots the longest-waiting animals at the top, and knows which rows have a bad or missing listing date.",
      findability: {
        parentArea: "Storefront",
        entryPoints: ["/storefront/animals", "Storefront > Animals > Waiting list"],
        navigationLayer: "Storefront admin tab nav (Animals tab), link at the top of the Animals page",
        discoveryCue: "A 'Waiting list' link beside the Adoptable animals heading.",
        expectedPath: ["/storefront", "/storefront/animals", "/storefront/animals/waiting"],
      },
      contentRoles: {
        defaultVisibleKeys: ["listed-count", "waiting-table"],
        deferredRegions: [
          {
            key: "rest-of-list",
            role: "Rows past the twenty-five longest-waiting, still in wait order on the same page.",
            trigger: "Reader opens 'Show the other N animals'.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Plain rescue words — listed, waiting, days, species. Never status codes, ids or timestamps.",
        actionLocation:
          "There is no action on this page; the one link points back to the Animals page to fix a date.",
        feedbackPrimitive: "None — the page is read-only and re-reads on every visit.",
        disclosurePattern:
          "The twenty-five longest-waiting rows are open on arrival; the rest of the list sits on the same page inside one disclosure, in order.",
        returnBehavior: "Nothing navigates away; the reader leaves via the Storefront tabs.",
      },
    },
    stateScenarios: {
      "no-storefront": {
        statePredicate: "No StorefrontConfig row exists.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/storefront/animals/waiting/page.tsx",
        },
        essentialEvidenceKeys: ["listed-count"],
        primaryExperience: { kind: "informational", messageKey: "adoption-waiting.no-storefront" },
        prohibitedActionKeys: [],
        completionSignal: "The lead says there is no storefront yet and links to setup.",
        errorCorrection:
          "This is distinguished from having no animals listed — no storefront is a setup problem, not an empty list.",
        recovery: { actionKey: "set-up-storefront", routePath: "/storefront/setup" },
      },
      "no-listed-animals": {
        statePredicate: "The storefront has no AdoptableAnimal with status 'available'.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/storefront/animals/waiting/page.tsx",
        },
        essentialEvidenceKeys: ["listed-count"],
        primaryExperience: { kind: "informational", messageKey: "adoption-waiting.empty" },
        prohibitedActionKeys: [],
        completionSignal:
          "An empty state says no animals are listed right now and points at the Animals page.",
        errorCorrection:
          "Animals on hold, pending or adopted are not waiting; the reader learns the list counts only listed animals.",
        recovery: { actionKey: "open-animals", routePath: "/storefront/animals" },
      },
      "animals-waiting": {
        statePredicate: "At least one AdoptableAnimal is 'available' with a listing date in the past.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/storefront/adoption-waiting-list.ts",
        },
        essentialEvidenceKeys: ["listed-count", "waiting-table"],
        primaryExperience: { kind: "informational", messageKey: "adoption-waiting.list" },
        prohibitedActionKeys: [],
        completionSignal:
          "Rows read longest wait first with whole days waited; the count of listed animals sits above the table.",
        errorCorrection:
          "A future listing date is shown as such with no day count and sorted after every dated row, never as a negative number; a missing date sorts last rather than hiding the animal.",
        recovery: { actionKey: "open-animals", routePath: "/storefront/animals" },
      },
      "cap-reached": {
        statePredicate: "More than one hundred animals are 'available'.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/storefront/adoption-waiting-list.ts",
        },
        essentialEvidenceKeys: ["listed-count", "waiting-table"],
        primaryExperience: { kind: "informational", messageKey: "adoption-waiting.capped" },
        prohibitedActionKeys: [],
        completionSignal:
          "The page shows the one hundred longest-waiting and says so at the bottom with the full listed count.",
        errorCorrection:
          "The reader knows the list is cut, and knows the cut is at the newest end, so nothing long-waiting is missing.",
        recovery: { actionKey: "open-animals", routePath: "/storefront/animals" },
      },
    },
    taskProtocol: {
      startRoute: "/storefront/animals/waiting",
      taskPrompt: "Which three animals have waited longest for adoption, and how many days each?",
      completionOracle:
        "The first three rows name the three longest-waiting listed animals and their day counts match the listing dates.",
      falseSuccessConditions: [
        "An animal on hold or already adopted is read as waiting.",
        "A future-dated animal is read as the longest wait because of a negative or huge number.",
        "A rabbit or other species that has waited longest is missed because the reader expected only dogs and cats.",
      ],
      acceptanceThresholds: [
        "The longest wait is the first row on arrival, with no click.",
        "Every listed animal is on the page; nothing needs a second page.",
        "A missing or future date is visible as such and never produces a day count.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:BI-899D7F00" },
    reviewRef: "BI-899D7F00",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-899D7F00",
        summary:
          "The owner filed the same request five times in three days with a decided-scope block: staff-only, no pagination, cap at 100 and say so, future dates out of the ordering, missing dates last, read-only over the stored listing date.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/app/(shell)/storefront/animals/page.tsx",
        summary:
          "The Animals admin page already lists every AdoptableAnimal with its status; publishedAt is the listing date it stores. This page reads the same rows in wait order and adds nothing to the model.",
      },
    ],
  },
];
