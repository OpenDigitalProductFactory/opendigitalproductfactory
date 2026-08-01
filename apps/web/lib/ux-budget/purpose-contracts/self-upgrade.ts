import type { RatifiedPurposeContractSource } from "../page-purpose";

const RECOVERY_ROUTE = "/docs/[[...slug]]";

export const SELF_UPGRADE_PURPOSE_CONTRACT = {
  schemaVersion: 1,
  status: "intent-ratified",
  routePath: "/ops/self-upgrade",
  intent: {
    primaryUser:
      "Platform operator responsible for keeping the install current and operable.",
    triggeringNeed:
      "An update is available, running, complete, blocked, or needs recovery.",
    prerequisites: [
      "The operator is authenticated with platform administration authority.",
    ],
    job: "Understand the current update state and take the one safe next action.",
    successOutcome:
      "The install reaches the intended version and returns healthy, or the operator reaches a truthful governed recovery path.",
    findability: {
      parentArea: "Delivery",
      entryPoints: ["Delivery home", "Runtime & Releases tabs"],
      navigationLayer: "section",
      discoveryCue: "Self-Upgrade",
      expectedPath: ["Delivery", "Track & release", "Self-upgrade"],
    },
    contentRoles: {
      defaultVisibleKeys: ["current-state", "next-action", "recovery-status"],
      deferredRegions: [
        {
          key: "release-details",
          role: "Version detail, business impact, recovery facts, and concise risks",
          trigger: "Version, impact & recovery",
        },
        {
          key: "deploy-controls-history",
          role: "Technical deploy controls, run history, local-change ledger, and diagnostics",
          trigger: "Deploy controls & history",
          defaultExpandedInScenarios: ["failed-recoverable"],
        },
      ],
    },
    familyConsistency: {
      terminology: "Self-Upgrade and platform update",
      actionLocation: "Co-located with the plain-language release status",
      feedbackPrimitive: "Report-kit Notice with an announced status",
      disclosurePattern:
        "Operational status and next action first; technical evidence in one details disclosure",
      returnBehavior: "Remain in Platform operations after completion or recovery",
    },
  },
  stateScenarios: {
    "update-available": {
      statePredicate:
        "The target lineage is newer than the deployed lineage and no run is active.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: [
        "current-state",
        "impact-on-work",
        "next-action",
        "recovery-status",
      ],
      primaryExperience: { kind: "command", actionKey: "start-upgrade" },
      prohibitedActionKeys: ["restore-previous-version"],
      completionSignalKey: "upgrade-queue-acknowledgement",
      completionSignal:
        "The request is acknowledged and the state advances to queued or running.",
      correctionSignalKey: "upgrade-request-error",
      errorCorrection:
        "A failed request is announced beside the action with a recovery route.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: RECOVERY_ROUTE,
      },
    },
    "queued-or-running": {
      statePredicate:
        "The latest run is queued, pending, running, or completing.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: [
        "current-state",
        "next-action",
        "recovery-status",
      ],
      primaryExperience: {
        kind: "informational",
        messageKey: "upgrade-progress",
      },
      prohibitedActionKeys: ["start-upgrade"],
      completionSignalKey: "upgrade-progress-visible",
      completionSignal:
        "A terminal run state and healthy served lineage replace progress.",
      correctionSignalKey: "stalled-run-recovery",
      errorCorrection:
        "A stalled or failed run exposes governed recovery without a duplicate start.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: RECOVERY_ROUTE,
      },
    },
    current: {
      statePredicate:
        "Status is available, no run is active or failed, and the deployed lineage is fresh or there is no newer target lineage.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: [
        "current-state",
        "next-action",
        "recovery-status",
      ],
      primaryExperience: {
        kind: "informational",
        messageKey: "current-status",
      },
      prohibitedActionKeys: ["start-upgrade"],
      completionSignalKey: "current-version-visible",
      completionSignal: "The running version and healthy state are visible.",
      correctionSignalKey: "status-refresh",
      errorCorrection:
        "A contradictory target or health signal advances to the matching scenario.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: RECOVERY_ROUTE,
      },
    },
    "failed-recoverable": {
      statePredicate:
        "The latest governed run failed and the portal remains available.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: [
        "current-state",
        "next-action",
        "recovery-status",
      ],
      primaryExperience: {
        kind: "command",
        actionKey: "open-recovery-controls",
      },
      prohibitedActionKeys: ["start-upgrade"],
      completionSignalKey: "recovery-controls-reachable",
      completionSignal:
        "The operator reaches the governed recovery controls and diagnostic evidence.",
      correctionSignalKey: "failure-reason-visible",
      errorCorrection:
        "The failure reason and recovery guidance remain available without hiding the running version.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: RECOVERY_ROUTE,
      },
    },
    blocked: {
      statePredicate:
        "Status is unavailable, or a newer target exists and Self-Upgrade is disabled, the job engine is unhealthy, or required scheduling context is missing.",
      stateSource: {
        oracleKey: "self-upgrade-status",
        sourceRef: "apps/web/lib/ux-budget/oracles/self-upgrade.ts",
      },
      essentialEvidenceKeys: [
        "current-state",
        "next-action",
        "recovery-status",
      ],
      primaryExperience: {
        kind: "command",
        actionKey: "resolve-blocker",
      },
      prohibitedActionKeys: ["start-upgrade"],
      completionSignalKey: "blocker-route-reachable",
      completionSignal:
        "The operator reaches the owning prerequisite or recovery guidance.",
      correctionSignalKey: "blocker-reason-visible",
      errorCorrection:
        "The blocker names the missing prerequisite instead of offering a blind retry.",
      recovery: {
        actionKey: "open-recovery-guidance",
        routePath: RECOVERY_ROUTE,
      },
    },
  },
  taskProtocol: {
    startRoute: "/workspace",
    taskPrompt:
      "Your platform needs attention. Find the update status and safely bring it current, or reach the correct recovery path.",
    completionOracle:
      "The served platform lineage matches the intended target and health is green, or the governed recovery surface is reached for a blocked or failed state.",
    falseSuccessConditions: [
      "The update is queued but never reaches a terminal healthy state.",
      "The page reports current while deployed and target lineage disagree.",
      "The operator opens raw logs without reaching the state-appropriate action or recovery.",
    ],
    acceptanceThresholds: [
      "The operator finds Self-Upgrade from Delivery > Track & release without search or a supplied URL.",
      "The state-appropriate action or message is fully visible in the first viewport.",
      "Desktop pointer, keyboard, 390 touch, mobile landscape, and 320 CSS-pixel reflow reach the same outcome.",
    ],
  },
  ratifiedBy: {
    role: "design-owner",
    ref: "BI-D27323A0",
  },
  reviewRef:
    "docs/superpowers/plans/2026-07-29-page-purpose-contract.md#self-upgrade-pilot-contract",
  intentEvidenceRefs: [
    {
      kind: "operator-request",
      ref: "BI-D27323A0",
      summary:
        "The operator requested an efficient, purpose-led Self-Upgrade experience with progressive disclosure.",
    },
    {
      kind: "design-review",
      ref: "cms6lzjbn0et901l2wlu2868l",
      summary:
        "The Purpose Contract program decomposed the evaluator and Self-Upgrade pilot as an independently shippable slice.",
    },
    {
      kind: "existing-behavior",
      ref: "apps/web/lib/self-upgrade/owner-summary.ts",
      summary:
        "The owner summary already projects update state, impact, reversibility, and next action from canonical status.",
    },
  ],
  consequentialAction: {
    actionKey: "start-upgrade",
    noActionConsequence:
      "When automatic updates are enabled the update waits for the next governed window; otherwise it remains pending.",
    reversibility:
      "The governed runner creates a recovery point before the update.",
    confirmation:
      "The operator explicitly starts or confirms any force or rollback action.",
    authority:
      "Only an authenticated platform operator may execute update or recovery commands.",
    recovery:
      "Failure retains the running version or restores the saved recovery point and links to the owning recovery guidance.",
  },
} satisfies RatifiedPurposeContractSource;
