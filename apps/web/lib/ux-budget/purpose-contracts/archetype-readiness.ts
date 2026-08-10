// Ratified page-purpose contract for /platform/archetype-readiness (BI-1A222A7A).

import type { PurposeContractModule } from ".";

export const ARCHETYPE_READINESS_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/platform/archetype-readiness",
    intent: {
      primaryUser:
        "A platform operator or founder reviewing which business archetype claims are currently supportable.",
      triggeringNeed:
        "Separating template-ready coverage from higher operational, connector, regulated, and sole-platform claims without reading package code or architecture memos.",
      prerequisites: [
        "Signed in with access to the Platform Overview family.",
        "The archetype readiness matrix has been maintained in @dpf/storefront-templates.",
      ],
      job: "Scan every archetype category, identify the highest earned claim tier, and see which evidence blocks higher claims.",
      successOutcome:
        "The operator can name the current claim tier for a category and cite the BI, epic, or evidence reference that blocks the next unsupported claim.",
      findability: {
        parentArea: "Platform",
        entryPoints: ["/platform", "Platform > Overview > Archetype Readiness"],
        navigationLayer: "Platform secondary nav, Overview family",
        discoveryCue:
          "An 'Archetype Readiness' item in the Overview family next to the Platform Hub and Schedule.",
        expectedPath: ["/platform", "/platform/archetype-readiness"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "category-count",
          "template-only-count",
          "ops-ready-count",
          "sole-platform-ready-count",
          "claim-gate-notice",
        ],
        deferredRegions: [
          {
            key: "readiness-matrix",
            role: "Per-category highest claim tier, blocked higher claims, and evidence references.",
            trigger: "Operator expands 'Category claim matrix'.",
          },
          {
            key: "tier-definitions",
            role: "Detailed tier meanings for template-ready, ops-ready, connector-ready, regulated-ready, and sole-platform-ready claims.",
            trigger: "Operator expands 'Tier definitions'.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Use the readiness-tier names from the shared matrix and speak in claim/evidence language, not sales promises.",
        actionLocation:
          "Navigation stays in the Platform Overview tab row; the page itself is read-only and table-oriented.",
        feedbackPrimitive:
          "Inline report badges and notices communicate claim status; there are no dialogs or destructive actions.",
        disclosurePattern:
          "Summary KPI cards and the claim-gate notice are visible on arrival; the full category matrix and tier definitions expand on demand so the detail shell stays under the net-new word budget.",
        returnBehavior:
          "The operator returns to the Platform Hub through the same Overview navigation family.",
      },
    },
    stateScenarios: {
      "matrix-readable": {
        statePredicate:
          "The shared archetype readiness matrix contains category records.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef:
            "packages/storefront-templates/src/archetype-readiness.ts#ARCHETYPE_READINESS_MATRIX",
        },
        essentialEvidenceKeys: [
          "category-count",
          "claim-gate-notice",
          "readiness-matrix",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "archetype-readiness.matrix-readable",
        },
        prohibitedActionKeys: ["edit-readiness-tier"],
        completionSignal:
          "Every matrix category appears with a highest claim tier and at least one blocking evidence reference when higher claims are blocked.",
        errorCorrection:
          "Missing or stale readiness rows are corrected in the shared matrix source, not copied into the page.",
        recovery: {
          actionKey: "open-platform-hub",
          routePath: "/platform",
        },
      },
      "sole-platform-blocked": {
        statePredicate:
          "At least one category is below the sole-platform-ready tier.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef:
            "apps/web/components/platform/ArchetypeReadinessMatrixPanel.tsx#buildArchetypeReadinessRows",
        },
        essentialEvidenceKeys: [
          "sole-platform-ready-count",
          "blocked-higher-claims",
          "evidence-refs",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "archetype-readiness.sole-platform-blocked",
        },
        prohibitedActionKeys: ["claim-sole-platform-ready"],
        completionSignal:
          "The blocked tier badges and evidence references make the unsupported higher claim visible without changing the matrix.",
        errorCorrection:
          "The operator follows the named BI or epic evidence reference before making a higher public or sales claim.",
        recovery: {
          actionKey: "review-tier-definitions",
          routePath: "/platform/archetype-readiness",
        },
      },
    },
    taskProtocol: {
      startRoute: "/platform/archetype-readiness",
      taskPrompt:
        "Find the current readiness claim for Food and Hospitality and name one blocker for a higher claim.",
      completionOracle:
        "The readiness table shows Food and Hospitality with its highest claim tier and a blocking evidence reference for a higher tier.",
      falseSuccessConditions: [
        "The operator repeats the architecture-review conclusion without reading the matrix row.",
        "A template-ready category is described as sole-platform-ready because the blocker badges were ignored.",
        "The page renders counts but no category-specific evidence reference is cited.",
      ],
      acceptanceThresholds: [
        "The target category is found from the Platform Overview navigation path.",
        "The cited tier matches the shared ARCHETYPE_READINESS_MATRIX value.",
        "The cited blocker is visible in the table or tier definitions without inspecting source code.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:mark-bodman-2026-07-31",
    },
    reviewRef: "BI-1A222A7A",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-1A222A7A",
        summary:
          "Operator asked for the platform adequacy finding to become a durable, readable surface rather than thread-only analysis.",
      },
      {
        kind: "existing-behavior",
        ref: "packages/storefront-templates/src/archetype-readiness.ts",
        summary:
          "The readiness tiers, matrix, and claim gate already exist as typed substrate and need an operator-facing consumer.",
      },
    ],
  },
];
