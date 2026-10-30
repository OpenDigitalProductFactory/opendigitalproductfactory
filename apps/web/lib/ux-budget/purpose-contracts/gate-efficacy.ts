// Ratified page-purpose contract for /ops/gate-efficacy (BI-FEDD8F45). Design:
// docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.6, §5.1.

import type { PurposeContractModule } from "../page-purpose";

const STATE_SOURCE = {
  oracleKey: "route-owned-read-model",
  sourceRef: "apps/web/lib/gpp/efficacy/efficacy-measures-store.ts#loadEfficacyReport",
} as const;

const RECOVERY = { actionKey: "open-dev-loop", routePath: "/ops/dev-loop" } as const;

export const GATE_EFFICACY_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/ops/gate-efficacy",
    intent: {
      primaryUser: "The platform owner deciding whether DPF's gates and guards earn the time they cost.",
      triggeringNeed:
        "Gates slow every change, and nobody could say which ones ever caught a real defect, so none could be retired or defended on evidence.",
      prerequisites: ["Signed in with the view_operations capability."],
      job: "See, for the last 14 days, how many guard checks ran, what they cost, how their refusals turned out, and which GPP measures the records cannot answer.",
      successOutcome:
        "The owner knows what was observed and what is unknown, and that no decision is waiting on them: wasteful guards reach a review item on their own.",
      findability: {
        parentArea: "Run the platform",
        entryPoints: ["Platform updates navigation, next to Dev loop", "/ops/gate-efficacy directly"],
        navigationLayer: "Platform updates sub-route",
        discoveryCue: "The Gate efficacy link sits beside Dev loop in the platform updates group.",
        expectedPath: ["/ops/self-upgrade", "/ops/gate-efficacy"],
      },
      contentRoles: {
        defaultVisibleKeys: ["period-summary", "unknown-measures", "no-decision-needed", "summary-stat-cards"],
        deferredRegions: [
          { key: "gpp-measures-table", role: "GPP §11 measures, proxies and approval load with numerators, denominators and omissions", trigger: "Open the GPP §11 measures disclosure" },
          { key: "guards-table", role: "Per-guard runs, time and refusal outcomes, most expensive first", trigger: "Open the guards disclosure" },
        ],
      },
      familyConsistency: {
        terminology:
          "Use guard check, refusal, caught, false refusal, overridden and unknown; guard ids appear only in the guard table.",
        actionLocation: "The page has no actions; the next-action line says nothing needs the owner's decision.",
        feedbackPrimitive: "Report-kit StatCards for counts and a warning badge wherever a value is unknown.",
        disclosurePattern: "Counts and the plain-language summary on arrival; both tables behind collapsed disclosure.",
        returnBehavior: "The page is read-only; reloading recomputes the last 14 days.",
      },
    },
    stateScenarios: {
      "no-runs-recorded": {
        statePredicate: "No guard outcome run was recorded in the last 14 days.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["period-summary", "unknown-measures", "empty-guard-table"],
        primaryExperience: { kind: "informational", messageKey: "gateEfficacy.noRuns" },
        prohibitedActionKeys: ["success-badge-on-unknown"],
        completionSignal: "The owner sees zero checks recorded and which measures are unknown, never a reassuring zero.",
        errorCorrection: "Runs appear once pregate, the pre-push gate or the guard loop submits them.",
        recovery: RECOVERY,
      },
      "runs-recorded": {
        statePredicate: "At least one guard outcome run was recorded in the last 14 days.",
        stateSource: STATE_SOURCE,
        essentialEvidenceKeys: ["period-summary", "summary-stat-cards", "unknown-measures"],
        primaryExperience: { kind: "informational", messageKey: "gateEfficacy.noDecisionNeeded" },
        prohibitedActionKeys: ["success-badge-on-unknown", "approval-action"],
        completionSignal: "The owner sees checks, refusals and unknown measures with numerators and denominators behind disclosure.",
        errorCorrection: "A measure the records cannot answer reads Unknown with what it leaves out.",
        recovery: RECOVERY,
      },
    },
    taskProtocol: {
      startRoute: "/ops/gate-efficacy",
      taskPrompt: "Find out whether the guards on this platform earn their cost, and whether anything needs your decision.",
      completionOracle:
        "The owner states how many guard checks ran, which measures are unknown, and that no decision is waiting on them.",
      falseSuccessConditions: [
        "An unknown measure reads as zero or carries a success badge.",
        "Caught or false refusal is presented as a causal finding without its pairing-proxy limitation.",
        "The page offers an approval or write action.",
      ],
      acceptanceThresholds: [
        "Every value shows its numerator and denominator or reads Unknown.",
        "M-2, M-5 and M-7 read Unknown until their record linkage exists.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "founder-direction:2026-10-14-BI-FEDD8F45" },
    reviewRef: "BI-FEDD8F45",
    intentEvidenceRefs: [
      {
        kind: "design-review",
        ref: "docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md",
        summary:
          "The design fixes the measures, their numerators, denominators and omissions, the pairing-proxy limitation and a read-only owner report composed from report-kit.",
      },
      {
        kind: "governance-decision",
        ref: "DI-E8D70429915B",
        summary: "A dedicated read-only ops page with two tables was chosen over MCP-only, a dev-loop section and a charted dashboard.",
      },
    ],
  },
];
