// Ratified page-purpose contract for /admin/issue-reports/upstream (BI-6ED89EC6,
// EP-35BA9476). Placement chosen by WWMD DI-F24F5CEB9CDB: the issue-report and
// platform-development pages are frozen by the UX route ratchet, so the one
// standing switch gets its own page rather than growing either.

import type { PurposeContractModule } from "../page-purpose";

const STATE_SOURCE = {
  oracleKey: "route-owned-read-model",
  sourceRef: "apps/web/lib/actions/feedback-escalation.ts#getUpstreamFeedbackConsent",
} as const;

const RECOVERY = { actionKey: "open-issue-reports", routePath: "/admin/issue-reports" } as const;

export const UPSTREAM_FEEDBACK_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/admin/issue-reports/upstream",
    intent: {
      primaryUser:
        "The person who runs this installation and decides whether the problems it finds may be sent to the project team.",
      triggeringNeed:
        "Problems triaged on this installation only reach the project team once someone allows it, and until now the only place to allow it appeared in the middle of reporting a single problem.",
      prerequisites: [
        "Signed in with the view_admin capability to read the state.",
        "Signed in with the manage_platform capability to change it.",
      ],
      job: "See whether this installation's triaged problems are being sent to the project team, and turn that on or off.",
      successOutcome:
        "The operator knows whether problems leave this installation, what is sent when they do, and a change is saved or refused with its reason.",
      findability: {
        parentArea: "Admin",
        entryPoints: [
          "The \"Problems found here are not reaching the ecosystem\" item in Needs you",
          "/admin/issue-reports/upstream directly",
        ],
        navigationLayer: "Admin issue-reports sub-route",
        discoveryCue:
          "The issue submission sweep raises one standing Needs-you item whose action, \"Turn on upstream feedback\", links here.",
        expectedPath: ["/workspace", "/admin/issue-reports/upstream"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "upstream-feedback-explanation",
          "upstream-feedback-switch",
          "upstream-feedback-state",
          "save-outcome",
        ],
        deferredRegions: [],
      },
      familyConsistency: {
        terminology:
          "Use problems, project team, upstream feedback, on and off; never relay, bridge or issue numbers.",
        actionLocation: "The single Save button sits under the switch it saves.",
        feedbackPrimitive: "A polite status line for a saved change and an alert line for a refusal.",
        disclosurePattern: "Everything is visible on arrival; the page carries one decision.",
        returnBehavior: "After saving, the page keeps the saved state and the Save button disables until the next change.",
      },
    },
    stateScenarios: {
      "upstream-feedback-off": {
        statePredicate: "PlatformDevConfig.upstreamFeedbackOptIn is false, contributions are not paused and the installation is not private.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["state-off", "what-is-sent", "turn-on-action"],
        primaryExperience: { kind: "command", actionKey: "turn-upstream-feedback-on" },
        prohibitedActionKeys: ["send-without-consent"],
        completionSignal: "The operator sees nothing leaves the installation, what would be sent, and can turn it on.",
        errorCorrection: "A refused save names its reason; the switch keeps the requested value so the operator can retry.",
        recovery: RECOVERY,
      },
      "upstream-feedback-on": {
        statePredicate: "PlatformDevConfig.upstreamFeedbackOptIn is true and neither the pause nor private mode applies.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["state-on", "turn-off-action"],
        primaryExperience: { kind: "command", actionKey: "turn-upstream-feedback-off" },
        prohibitedActionKeys: [],
        completionSignal: "The operator sees triaged problems are sent daily and can turn it off.",
        errorCorrection: "A refused save names its reason.",
        recovery: RECOVERY,
      },
      "upstream-feedback-blocked": {
        statePredicate: "The installation is private, contributions are paused, or the viewer lacks manage_platform.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["blocked-reason", "disabled-switch"],
        primaryExperience: { kind: "informational", messageKey: "upstreamFeedback.reason.blocked" },
        prohibitedActionKeys: ["send-without-consent"],
        completionSignal: "The operator is told why the switch cannot apply here.",
        errorCorrection: "The reason names what governs it: private mode, the master pause, or the missing capability.",
        recovery: RECOVERY,
      },
    },
    taskProtocol: {
      startRoute: "/admin/issue-reports/upstream",
      taskPrompt: "Find out whether problems found on this installation reach the project team, then turn that on.",
      completionOracle:
        "The operator states whether problems leave the installation, and a save ends in a saved or refused outcome rather than silence.",
      falseSuccessConditions: [
        "The switch reads as on while the installation is private or contributions are paused.",
        "A refused save is shown as saved.",
        "The page implies something has been sent when the switch only allows future sending.",
      ],
      acceptanceThresholds: [
        "The switch is read-only without manage_platform.",
        "The switch is read-only and explained while private or paused.",
        "Saving uses the existing consent action, so who and when stay recorded.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-11-12" },
    reviewRef: "BI-6ED89EC6",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "operator-request:mark-bodman-2026-11-12",
        summary:
          "The owner directed all remaining work to realize EP-35BA9476's outcomes, the first of which is that a non-coding installation's problems are submitted to the ecosystem.",
      },
      {
        kind: "governance-decision",
        ref: "DI-F24F5CEB9CDB",
        summary:
          "WWMD chose a focused net-new route over growing the frozen issue-report or platform-development pages (high confidence, margin 6.70).",
      },
    ],
  },
];
