// Ratified page-purpose contract for /ops/stack-currency (BI-6328BCA6, EP-VSL-SURFACE).

import type { PurposeContractModule } from ".";

export const STACK_CURRENCY_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/ops/stack-currency",
    intent: {
      primaryUser:
        "A platform operator or founder checking the currency of the platform's own technology stack.",
      triggeringNeed:
        "Seeing which of our own runtimes and frameworks are current, approaching end of life, or unsupported — without reading manifests or chasing vendor EOL schedules — and distinct from the discovered customer estate.",
      prerequisites: [
        "Signed in with access to the Operations Runtime & Releases family.",
        "The curated platform-stack definition is maintained in apps/web/lib/ops/platform-stack.ts.",
      ],
      job: "Scan the platform's own key components, read each one's currency status on the canonical Currency axis, and see which components need an upgrade path.",
      successOutcome:
        "The operator can name any component's current version and currency status, and identify which components are approaching or past end of life (or lack a recorded EOL date) for the upgrade roadmap.",
      findability: {
        parentArea: "Operations",
        entryPoints: ["/ops", "Operations > Runtime & Releases > Stack Currency"],
        navigationLayer: "Ops secondary nav, Runtime & Releases group",
        discoveryCue:
          "A 'Stack Currency' tab in the Runtime & Releases group next to Patches.",
        expectedPath: ["/ops", "/ops/stack-currency"],
      },
      contentRoles: {
        defaultVisibleKeys: ["lead-summary", "stack-currency-table"],
        deferredRegions: [
          {
            key: "upgrade-actionable-notice",
            role: "A notice counting components that are approaching or past end of life and need an upgrade path.",
            trigger: "Rendered only when at least one component is in an actionable currency state.",
          },
          {
            key: "unsourced-notice",
            role: "A prompt to record support/EOL dates for components whose currency cannot yet be computed.",
            trigger: "Rendered only when at least one component has no recorded EOL date.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Use the canonical Currency-axis names (current / approaching-eol / unsupported / end-of-life) and 'EOL not sourced' for undated components; speak in currency and upgrade-path language.",
        actionLocation:
          "Navigation stays in the Ops Runtime & Releases tab row; the page itself is read-only and table-oriented.",
        feedbackPrimitive:
          "Inline report badges and notices communicate currency status; there are no dialogs or destructive actions.",
        disclosurePattern:
          "Lead summary and the currency table are visible on arrival; the actionable-upgrade and unsourced notices appear only when their condition holds.",
        returnBehavior:
          "The operator returns to the discovered-estate view through the sibling Patches tab in the same Runtime & Releases family.",
      },
    },
    stateScenarios: {
      "stack-readable": {
        statePredicate:
          "The curated platform-stack definition contains component records.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/ops/platform-stack.ts#PLATFORM_STACK",
        },
        essentialEvidenceKeys: [
          "component-count",
          "currency-status",
          "stack-currency-table",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "stack-currency.stack-readable",
        },
        prohibitedActionKeys: ["edit-currency-status"],
        completionSignal:
          "Every curated component appears with a current version and a resolved currency status (including 'EOL not sourced').",
        errorCorrection:
          "Stale versions or missing EOL dates are corrected in the curated platform-stack source, not copied into the page.",
        recovery: {
          actionKey: "open-patches",
          routePath: "/ops/patches",
        },
      },
      "upgrade-needed": {
        statePredicate:
          "At least one component is approaching-eol, unsupported, or end-of-life.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/ops/platform-stack.ts#assessPlatformStack",
        },
        essentialEvidenceKeys: [
          "actionable-count",
          "currency-status",
          "support-ends-date",
        ],
        primaryExperience: {
          kind: "informational",
          messageKey: "stack-currency.upgrade-needed",
        },
        prohibitedActionKeys: ["auto-upgrade-component"],
        completionSignal:
          "Components needing an upgrade path are visibly flagged with their currency status and support-end date.",
        errorCorrection:
          "The operator follows the flagged component to the upgrade roadmap; the board never mutates the stack itself.",
        recovery: {
          actionKey: "open-patches",
          routePath: "/ops/patches",
        },
      },
    },
    taskProtocol: {
      startRoute: "/ops/stack-currency",
      taskPrompt:
        "Find whether any platform component is approaching or past end of life, and name one that lacks a recorded EOL date.",
      completionOracle:
        "The currency table shows each component's status, with actionable components flagged and undated ones shown as 'EOL not sourced'.",
      falseSuccessConditions: [
        "The operator reports a component as current when its status is 'EOL not sourced' (no date recorded).",
        "A customer-estate patch finding is described as part of the platform's own stack.",
        "The page renders component names but no currency status per component.",
      ],
      acceptanceThresholds: [
        "The board is found from the Ops Runtime & Releases navigation path.",
        "The cited currency status matches the assessPlatformStack result for that component.",
        "The distinction between our own stack and the discovered customer estate (Patches) is preserved.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:ep-vsl-surface-2026-08-15",
    },
    reviewRef: "BI-6328BCA6",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-VSL-SURFACE",
        summary:
          "Owner asked to surface the tech-stack lifecycle the platform is subject to as a live board off the canonical Currency axis.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/lifecycle.ts#deriveCurrency",
        summary:
          "The Currency axis and deriveCurrency already exist as the canonical substrate; this board is their operator-facing own-stack consumer.",
      },
    ],
  },
];
