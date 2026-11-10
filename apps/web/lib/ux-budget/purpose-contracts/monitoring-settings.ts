// Ratified page-purpose contract for /admin/settings/monitoring (BI-8BBFE50B,
// slice D5 of BI-83260BB3). Design:
// docs/superpowers/specs/2026-10-13-monitoring-operator-choice-design.md §6.

import type { PurposeContractModule } from "../page-purpose";

const STATE_SOURCE = {
  oracleKey: "route-owned-read-model",
  sourceRef: "apps/web/lib/platform-runtime/monitoring-switch-loader.ts#loadMonitoringSwitchView",
} as const;

const RECOVERY = { actionKey: "open-runtime-health", routePath: "/platform/ai/runtime-health" } as const;

export const MONITORING_SETTINGS_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/admin/settings/monitoring",
    intent: {
      primaryUser:
        "The platform owner deciding whether this installation spends memory and CPU on Prometheus and Grafana.",
      triggeringNeed:
        "Monitoring is an optional capability with a real resource cost, and an operator needs one place to see whether it is running and to turn it on or off without editing install files.",
      prerequisites: [
        "Signed in with the view_admin capability to read the state.",
        "Signed in with the manage_platform capability to change it.",
      ],
      job: "See whether monitoring is on, off, changing or out of step with what is running, what it costs, and turn it on or off.",
      successOutcome:
        "The operator knows the observed monitoring state and its cost, and a requested change ends in a plain outcome naming the change id when it fails.",
      findability: {
        parentArea: "Admin",
        entryPoints: [
          "/platform/ai/runtime-health, from an inactive or degraded monitoring service's action",
          "/admin/settings/monitoring directly",
        ],
        navigationLayer: "Admin settings sub-route",
        discoveryCue:
          "The action text on a prometheus, grafana or postgres-exporter row in capability service health links here.",
        expectedPath: ["/platform/ai/runtime-health", "/admin/settings/monitoring"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "monitoring-status-badge",
          "monitoring-explanation",
          "monitoring-cost",
          "monitoring-switch",
          "last-change",
        ],
        deferredRegions: [],
      },
      familyConsistency: {
        terminology:
          "Use monitoring, on, off and change in operator copy; capability keys and service names appear only where the operator must quote them.",
        actionLocation:
          "The single on/off button sits under the status and cost it changes.",
        feedbackPrimitive:
          "An inline status badge for state and a polite live-region line for each request's outcome.",
        disclosurePattern:
          "Everything is visible on arrival; the page carries one decision and its evidence.",
        returnBehavior:
          "After a request the page refreshes in place so the observed state replaces the requested one.",
      },
    },
    stateScenarios: {
      "monitoring-off": {
        statePredicate: "Install-state does not enable runtime:deep-observability and none of its services are present.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["status-off", "cost", "turn-on-action"],
        primaryExperience: { kind: "command", actionKey: "turn-monitoring-on" },
        prohibitedActionKeys: ["toggle-while-unreconciled"],
        completionSignal: "The operator sees monitoring is off, what turning it on costs, and can turn it on.",
        errorCorrection: "A failed request names its reason and change id; the operator can try again.",
        recovery: RECOVERY,
      },
      "monitoring-on": {
        statePredicate: "Install-state enables runtime:deep-observability and prometheus, grafana and postgres-exporter are observed running.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["status-on", "turn-off-action"],
        primaryExperience: { kind: "command", actionKey: "turn-monitoring-off" },
        prohibitedActionKeys: ["toggle-while-unreconciled"],
        completionSignal: "The operator sees monitoring is on and can turn it off.",
        errorCorrection: "A drain-required result tells the operator to let dependent work finish before trying again.",
        recovery: RECOVERY,
      },
      "monitoring-unreconciled": {
        statePredicate: "The capability records cannot be reconciled with install-state: a catalog capability has no record, or install-state was written for another catalog.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["status-unreconciled", "divergence-summary", "disabled-switch-reason"],
        primaryExperience: { kind: "informational", messageKey: "monitoringSettings.reason.unreconciled" },
        prohibitedActionKeys: ["toggle-while-unreconciled"],
        completionSignal: "The operator is told the capability records need repair first and where to look.",
        errorCorrection: "The operator follows the runtime health link; the switch unlocks once the records are complete.",
        recovery: RECOVERY,
      },
    },
    taskProtocol: {
      startRoute: "/admin/settings/monitoring",
      taskPrompt: "Find out whether monitoring is running on this installation and what it costs, then turn it on or off.",
      completionOracle:
        "The operator states the observed monitoring state, and a requested change ends in a named outcome rather than silence.",
      falseSuccessConditions: [
        "Monitoring reads as on while one of its services is absent.",
        "The switch accepts a request while the capability records cannot be reconciled.",
        "A monitoring record that disagrees with install-state is shown as the monitoring state.",
        "A failed request is shown without its reason or change id.",
      ],
      acceptanceThresholds: [
        "On requires the capability enabled and all three services observed.",
        "The switch is read-only without manage_platform.",
        "Every coordinator result maps to catalog copy.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "founder-direction:2026-10-13-BI-83260BB3" },
    reviewRef: "BI-8BBFE50B",
    intentEvidenceRefs: [
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-10-13-monitoring-operator-choice-design.md",
        summary:
          "The design fixes observation-based state, one on/off button for manage_platform, outcome copy per coordinator result and the reconcile-first lock.",
      },
    ],
  },
];
