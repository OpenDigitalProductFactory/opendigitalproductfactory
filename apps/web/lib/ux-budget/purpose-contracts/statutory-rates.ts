// Ratified page-purpose contract for /finance/settings/statutory-rates (BI-8E1FD1BD).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so this page
// arrives ratified. Shape mirrors mileage.ts.
//
// This is the only place a person can confirm a statutory payroll figure. The
// rules shipped in #5134 with no human-facing door: agents are refused
// ratification by design and payroll resolves ratified figures only, so until
// this page existed no figure — however well cited — could reach a payroll.

import type { PurposeContractModule } from "../page-purpose";

const ROUTE = "/finance/settings/statutory-rates";
const SOURCE = "apps/web/app/(shell)/finance/settings/statutory-rates/page.tsx";

export const STATUTORY_RATES_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: ROUTE,
    intent: {
      primaryUser:
        "The person who runs payroll or finance for the organization — often the owner of a small business — who is accountable for the tax figures payroll uses.",
      triggeringNeed:
        "Payroll cannot compute a tax until somebody has confirmed the official figure for it, and a figure a coworker found on the web must be checked against the authority before money depends on it.",
      prerequisites: [
        "Signed in with finance management permission.",
        "Either a coworker has proposed a cited figure, or the person has the authority's own page open and can quote it.",
      ],
      job: "See which payroll tax figures are still missing, check each researched figure against its quoted source, and confirm or reject it — or enter one read yourself.",
      successOutcome:
        "Every figure payroll needs for the current year is confirmed, each traceable to the authority's own publication and to the person who confirmed it.",
      findability: {
        parentArea: "Finance",
        entryPoints: ["/finance/configuration", "Finance > Configuration > Statutory Rates"],
        navigationLayer: "Finance area tab nav",
        discoveryCue: "A 'Statutory Rates' item under Finance Configuration, beside Tax Remittance.",
        expectedPath: ["/finance", "/finance/configuration", ROUTE],
      },
      contentRoles: {
        defaultVisibleKeys: ["missing-figures", "waiting-figures", "confirm-control", "confirmed-figures"],
        deferredRegions: [
          {
            key: "manual-entry-form",
            role: "Ten-field form for entering a figure the person has read themselves, at the same citation bar a coworker's proposal faces.",
            trigger: "Open 'Enter a figure you have read yourself'.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Plain words — figure, confirm, reject, source, the passage that states it. Rates read as the authority prints them (6.2%), never as stored fractions; never rule ids or enum values.",
        actionLocation:
          "Confirm and Reject sit on the figure's own card, directly beneath its quoted source, so the decision is made with the evidence in view.",
        feedbackPrimitive:
          "An inline alert region reports a refusal in plain words — no native dialogs.",
        disclosurePattern:
          "Missing, waiting and confirmed figures show by default; the ten-field manual entry form stays collapsed until asked for.",
        returnBehavior:
          "Confirming or rejecting never navigates away; the figure moves group in place.",
      },
    },
    stateScenarios: {
      "no-permission": {
        statePredicate: "The signed-in user lacks manage_finance.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["missing-figures"],
        primaryExperience: { kind: "informational", messageKey: "statutory-rates.no-permission" },
        prohibitedActionKeys: ["confirm-figure", "reject-figure", "record-figure"],
        completionSignal: "A message says confirming tax figures needs finance management permission.",
        errorCorrection:
          "This is distinguished from there being no figures — it is a permission boundary, not an empty list.",
        recovery: { actionKey: "open-finance-home", routePath: "/finance" },
      },
      "nothing-confirmed": {
        statePredicate: "No PayrollTaxRule is ratified for US federal payroll.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["missing-figures", "confirmed-figures"],
        primaryExperience: { kind: "informational", messageKey: "statutory-rates.nothing-confirmed" },
        prohibitedActionKeys: [],
        completionSignal:
          "The header counts every missing federal figure by name, and the confirmed group says payroll cannot compute these taxes yet.",
        errorCorrection:
          "An absent figure is stated out loud rather than shown as an empty table that reads like 'all fine'.",
        recovery: { actionKey: "record-figure", routePath: ROUTE },
      },
      "figures-waiting": {
        statePredicate: "At least one PayrollTaxRule has status 'proposed'.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["waiting-figures", "confirm-control"],
        primaryExperience: { kind: "informational", messageKey: "statutory-rates.figures-waiting" },
        prohibitedActionKeys: [],
        completionSignal:
          "Each waiting figure shows its value, the source URL, when it was read and the quoted passage, with Confirm and Reject beneath.",
        errorCorrection:
          "Reject requires a reason, which is kept, so the researcher learns what to find instead. A figure with no source cannot be confirmed.",
        recovery: { actionKey: "reject-figure", routePath: ROUTE },
      },
      "all-confirmed": {
        statePredicate: "Every required US federal figure has a ratified rule in force today.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["missing-figures", "confirmed-figures"],
        primaryExperience: { kind: "informational", messageKey: "statutory-rates.all-confirmed" },
        prohibitedActionKeys: [],
        completionSignal: "The header reads 'ready' and lists the confirmed figures with their sources.",
        errorCorrection:
          "Confirming a newer figure closes the earlier one's window rather than retiring it, so closed periods keep the figure that applied to them.",
        recovery: { actionKey: "open-finance-home", routePath: "/finance" },
      },
    },
    taskProtocol: {
      startRoute: ROUTE,
      taskPrompt: "Make sure payroll has this year's Social Security and Medicare rates.",
      completionOracle:
        "The US federal header reads 'ready', and each confirmed figure links to an irs.gov or ssa.gov page with the quoted passage that states it.",
      falseSuccessConditions: [
        "A figure is confirmed without its quoted passage being read against the source.",
        "A rate typed as 6.2 is stored as 6.2 rather than 0.062, inflating withholding a hundredfold.",
        "An empty confirmed list is read as 'nothing needed' rather than 'nothing usable yet'.",
        "An agent signed into a browser confirms its own proposal.",
      ],
      acceptanceThresholds: [
        "Confirming a waiting figure takes one interaction from its card.",
        "No figure without a source URL can be confirmed.",
        "The automation persona is refused confirmation, rejection and direct entry.",
        "Rates are entered and displayed as percentages and stored as fractions.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-11-12" },
    reviewRef: "BI-8E1FD1BD",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-8E1FD1BD",
        summary:
          "Founder directed full absorption of Gusto-class payroll, routed statutory rate acquisition through an AI coworker with human confirmation, and on 2026-11-12 asked for the thread's outcome to be delivered. Investigation found the confirmation step had never been built: a proposed figure could never become one payroll uses. This page and its server actions close that gap.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/finance/statutory-rules.ts",
        summary:
          "checkStatutoryRatification already refuses every agent and resolveStatutoryRule already resolves ratified figures only. This page is the human caller those rules always assumed, reading the same model so the two cannot drift.",
      },
    ],
  },
];
