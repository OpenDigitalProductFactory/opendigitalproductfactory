import {
  purposeContractSourceSchema,
  type PurposeContractSource,
} from "../page-purpose";

export type PurposeContractModule = readonly PurposeContractSource[];

import { GRAPH_EXPLORER_PURPOSE_CONTRACTS } from "./graph-explorer";

const PLATFORM_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/platform/archetype-readiness",
    intent: {
      primaryUser: "Platform operator",
      triggeringNeed: "Know which business archetype coverage claims are safe to make.",
      prerequisites: ["The archetype readiness matrix is seeded."],
      job: "Review current archetype claim levels and the evidence blocking higher claims.",
      successOutcome: "The operator can see the current claimable tier and next evidence for each archetype category.",
      findability: {
        parentArea: "Platform",
        entryPoints: ["Platform Overview navigation"],
        navigationLayer: "section",
        discoveryCue: "Archetype Readiness",
        expectedPath: ["Platform", "Overview", "Archetype Readiness"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "category-summary",
          "claim-gate-notice",
          "readiness-matrix",
        ],
        deferredRegions: [
          {
            key: "tier-definitions",
            role: "Explain tier meanings without crowding the default table.",
            trigger: "Tier definitions disclosure",
          },
        ],
      },
      familyConsistency: {
        terminology: "Archetype Readiness",
        actionLocation: "none-read-only",
        feedbackPrimitive: "status-badge",
        disclosurePattern: "details",
        returnBehavior: "return-to-platform-overview",
      },
    },
    stateScenarios: {
      populated: {
        statePredicate: "ARCHETYPE_READINESS_MATRIX contains category records",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "@dpf/storefront-templates:ARCHETYPE_READINESS_MATRIX",
        },
        essentialEvidenceKeys: [
          "category-summary",
          "highest-claim",
          "evidence-refs",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "readiness-matrix-visible",
        },
        prohibitedActionKeys: ["edit-claim", "approve-claim"],
        completionSignal: "Operator can identify highest claim and blocker evidence.",
        errorCorrection: "Show an inline empty or unavailable state rather than inventing readiness data.",
        recovery: {
          actionKey: "return-to-platform-overview",
          routePath: "/platform",
        },
      },
    },
    taskProtocol: {
      startRoute: "/platform/archetype-readiness",
      taskPrompt: "Find which archetype categories are sole-platform ready and what blocks the rest.",
      completionOracle: "readiness-matrix-visible-with-blockers",
      falseSuccessConditions: [
        "The page shows copied readiness data that does not match the package matrix.",
        "The route is only reachable by manually typing the URL.",
      ],
      acceptanceThresholds: [
        "Matrix rows derive from @dpf/storefront-templates.",
        "Blocked higher-tier evidence is visible for each category.",
        "The page is reachable from Platform Overview navigation.",
      ],
    },
    ratifiedBy: {
      role: "design-owner",
      ref: "DI-899975251014",
    },
    reviewRef: "docs/superpowers/plans/2026-07-31-archetype-readiness-surface.md#design-grounding",
    intentEvidenceRefs: [
      {
        kind: "governance-decision",
        ref: "DI-899975251014",
        summary: "Platform Overview subpage chosen over AI readiness tab or docs-only review.",
      },
      {
        kind: "design-review",
        ref: "docs/ux-fit/2026-07-31-archetype-readiness-surface.ux-fit.json",
        summary: "UX-fit record scopes the new route and records considered options.",
      },
      {
        kind: "existing-behavior",
        ref: "packages/storefront-templates/src/archetype-readiness.ts",
        summary: "Existing readiness matrix and evaluator remain the data source.",
      },
    ],
  },
];

const CONTRACT_MODULES: readonly PurposeContractModule[] = [
  GRAPH_EXPLORER_PURPOSE_CONTRACTS,
  PLATFORM_CONTRACTS,
];

export function buildPurposeContractSourceIndex(
  modules: readonly PurposeContractModule[] = CONTRACT_MODULES,
): Readonly<Record<string, PurposeContractSource>> {
  const contracts: Record<string, PurposeContractSource> = {};

  for (const moduleContracts of modules) {
    for (const candidate of moduleContracts) {
      const contract = purposeContractSourceSchema.parse(candidate);
      if (contracts[contract.routePath]) {
        throw new Error(
          `[page-purpose] Duplicate contract source for ${contract.routePath}.`,
        );
      }
      contracts[contract.routePath] = contract;
    }
  }

  return contracts;
}

export const PURPOSE_CONTRACT_SOURCES =
  buildPurposeContractSourceIndex();
