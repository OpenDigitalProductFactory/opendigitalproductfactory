// Ratified page-purpose contract for /finance/mileage (EP-MILEAGE-ABSORB).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so the driver
// mileage page arrives ratified. Shape mirrors recruiting-pipeline.ts.
//
// This is the surface that makes the mileage substrate reachable: schema, rules
// and pricing all merged with no route and no write path, so drives could be
// recorded by nothing and read by nobody.

import type { PurposeContractModule } from ".";

export const MILEAGE_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/finance/mileage",
    intent: {
      primaryUser:
        "An employee who drives for work — a field technician, mobile tradesperson, or anyone whose own vehicle carries them to customers.",
      triggeringNeed:
        "Being reimbursed for business driving without keeping a paper log or re-typing a month of trips into a spreadsheet at the end of the month.",
      prerequisites: [
        "Signed in with a user account linked to an employee record.",
        "Drives exist: captured automatically by the mobile app under a granted location consent, or entered manually.",
      ],
      job: "Review the drives captured for you, mark each one business or personal, and see what the business owes you for them.",
      successOutcome:
        "The driver sees every captured drive, classifies the unclassified ones in a single tap each, and reads the reimbursable amount for the ones already priced.",
      findability: {
        parentArea: "Finance",
        entryPoints: ["/finance", "Finance > Mileage"],
        navigationLayer: "Finance area tab nav",
        discoveryCue: "A 'Mileage' tab in the Finance area, beside My Expenses.",
        expectedPath: ["/finance", "/finance/mileage"],
      },
      contentRoles: {
        defaultVisibleKeys: ["unclassified-count", "trip-list", "classification-control"],
        deferredRegions: [],
      },
      familyConsistency: {
        terminology:
          "Plain driving words — drive, business, personal, commute, reimbursable. Never Trip ids, coordinates, or metres.",
        actionLocation:
          "The classification control sits on the drive's own row; choosing re-reads that row in place.",
        feedbackPrimitive:
          "Inline pending state on the row being classified — no native dialogs.",
        disclosurePattern:
          "Every captured drive shows by default; a claimed drive shows its classification as settled text rather than an editable control.",
        returnBehavior:
          "Classifying never navigates away — the driver stays on the list and continues down it.",
      },
    },
    stateScenarios: {
      "no-employee-record": {
        statePredicate: "The signed-in user has no linked EmployeeProfile.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/finance/mileage/page.tsx",
        },
        essentialEvidenceKeys: ["unclassified-count"],
        primaryExperience: { kind: "informational", messageKey: "mileage.no-employee-record" },
        prohibitedActionKeys: [],
        completionSignal:
          "A message explains that no drives can belong to this account and names who can link it.",
        errorCorrection:
          "This is distinguished from having no drives yet — an unlinked account is a setup problem, not an empty month.",
        recovery: { actionKey: "open-finance-home", routePath: "/finance" },
      },
      "no-drives": {
        statePredicate: "The employee has no active Trip rows.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/finance/mileage/page.tsx",
        },
        essentialEvidenceKeys: ["unclassified-count"],
        primaryExperience: { kind: "informational", messageKey: "mileage.no-drives" },
        prohibitedActionKeys: [],
        completionSignal:
          "An empty state explains that drives appear automatically once capture is switched on in the mobile app.",
        errorCorrection:
          "The driver learns capture is a mobile setting rather than concluding the feature is broken.",
        recovery: { actionKey: "open-finance-home", routePath: "/finance" },
      },
      "drives-awaiting-classification": {
        statePredicate: "At least one active Trip has classification 'unclassified'.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/finance/mileage/page.tsx",
        },
        essentialEvidenceKeys: ["unclassified-count", "trip-list", "classification-control"],
        primaryExperience: { kind: "informational", messageKey: "mileage.awaiting-classification" },
        prohibitedActionKeys: [],
        completionSignal:
          "The header counts the waiting drives and each unclassified row offers business, personal and commute in one tap.",
        errorCorrection:
          "Choosing again re-classifies in place; nothing is committed to money until a claim is raised.",
        recovery: { actionKey: "reclassify-drive", routePath: "/finance/mileage" },
      },
      "drives-claimed": {
        statePredicate: "At least one Trip carries an expenseItemId.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/finance/mileage/page.tsx",
        },
        essentialEvidenceKeys: ["trip-list"],
        primaryExperience: { kind: "informational", messageKey: "mileage.claimed" },
        prohibitedActionKeys: ["reclassify-drive"],
        completionSignal:
          "A claimed drive reads as settled and offers no classification control.",
        errorCorrection:
          "A drive that already priced a reimbursement is accounting evidence; the page refuses to let its classification change rather than silently allowing a mismatch with the claim.",
        recovery: { actionKey: "open-my-expenses", routePath: "/finance/my-expenses" },
      },
    },
    taskProtocol: {
      startRoute: "/finance/mileage",
      taskPrompt: "Mark last week's drives as business or personal and tell me what I am owed.",
      completionOracle:
        "Every drive shows a classification, and the reimbursable column reads a money amount for the priced ones.",
      falseSuccessConditions: [
        "A commute drive is classified business, inflating the claim.",
        "An unpriced drive's blank amount is read as zero owed rather than not-yet-priced.",
        "A claimed drive is believed to be still editable.",
      ],
      acceptanceThresholds: [
        "Classifying a drive takes one interaction from the list.",
        "A claimed drive cannot be reclassified from this page.",
        "An unpriced drive shows an explicit placeholder, never a zero amount.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-08-23" },
    reviewRef: "BI-6D98AD8A",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-MILEAGE-ABSORB",
        summary:
          "Founder directed full native absorption of MileIQ-class mileage tracking, then asked whether the feature had actually been implemented for the archetypes that need it. It had not: the substrate, rules and pricing merged with no route and no write path, so this page and its server actions close that gap.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/mileage/monetisation.ts",
        summary:
          "priceTrips already prices classified business drives at the effective-dated rate in force on the drive date and reports every skipped drive with a reason. This page is its human-facing surface, reading the same model so the two never drift.",
      },
    ],
  },
];
