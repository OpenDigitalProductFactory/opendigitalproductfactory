// Ratified page-purpose contract for /finance/payroll (BI-099EAE30).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so this page
// arrives ratified. Shape mirrors statutory-rates.ts.
//
// Before this page nothing in the portal created a PayRun: the gross-to-net
// engine, pay-run persistence and the bank file all existed with no caller.

import type { PurposeContractModule } from "../page-purpose";

const ROUTE = "/finance/payroll";
const SOURCE = "apps/web/app/(shell)/finance/payroll/page.tsx";

export const PAYROLL_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: ROUTE,
    intent: {
      primaryUser:
        "The person who runs payroll for the organization, often the owner of a small business, accountable for paying staff the right net amount and withholding the right tax.",
      triggeringNeed:
        "It is pay day for a period, and wages and withholding must be computed from each employee's pay, time and W-4 using confirmed tax figures.",
      prerequisites: [
        "Signed in with finance management permission.",
        "Each paid employee has a pay rate, and the federal and work-state tax figures are confirmed on Statutory Rates.",
      ],
      job: "See what still blocks payroll, record each employee's W-4, compute the pay run for a period, and review every payslip line before anything is approved.",
      successOutcome:
        "A draft pay run exists for the period whose payslips show each employee's earnings, federal and state withholding, Social Security and Medicare, net pay and employer taxes, computed from their own W-4.",
      findability: {
        parentArea: "Finance",
        entryPoints: ["/finance/spend", "Finance > Spend > Payroll"],
        navigationLayer: "Finance area tab nav",
        discoveryCue: "A 'Payroll' item under Finance Spend, beside Expenses.",
        expectedPath: ["/finance", "/finance/spend", ROUTE],
      },
      contentRoles: {
        defaultVisibleKeys: ["blockers", "who-is-paid", "pay-runs"],
        deferredRegions: [
          {
            key: "w4-form",
            role: "Form W-4 entry: filing status, Steps 2 to 4, exempt, work state and the first pay date it applies to.",
            trigger: "Open 'Record a W-4'.",
          },
          {
            key: "run-form",
            role: "Period, pay date and pay frequency for computing a pay run.",
            trigger: "Open 'Run payroll for a period'.",
          },
          {
            key: "payslip-lines",
            role: "Every earning, deduction and employer tax line of each payslip in a run.",
            trigger: "Open a pay run.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Plain payroll words: pay run, payslip, W-4, filing status, federal income tax, Social Security, Medicare, net pay. US payslips never say National insurance.",
        actionLocation:
          "Recording a W-4 sits with the list of who is paid; computing a run sits above the runs it produces.",
        feedbackPrimitive: "An inline status or alert region reports the outcome in plain words.",
        disclosurePattern:
          "Blockers, who is paid and the run list show by default; both forms and each run's payslip lines stay collapsed until asked for.",
        returnBehavior: "Saving a W-4 or computing a run never navigates away; the page refreshes in place.",
      },
    },
    stateScenarios: {
      "no-permission": {
        statePredicate: "The signed-in user lacks manage_finance.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["blockers"],
        primaryExperience: { kind: "informational", messageKey: "payroll.no-permission" },
        prohibitedActionKeys: ["record-w4", "compute-pay-run"],
        completionSignal: "A message says running payroll needs finance management permission.",
        errorCorrection: "A permission boundary, not an empty payroll.",
        recovery: { actionKey: "open-finance-home", routePath: "/finance" },
      },
      blocked: {
        statePredicate: "A federal or work-state figure is unconfirmed, a paid employee has no W-4, or nobody has a pay rate.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["blockers", "who-is-paid"],
        primaryExperience: { kind: "informational", messageKey: "payroll.blocked" },
        prohibitedActionKeys: [],
        completionSignal: "The lead counts the blockers and the list names each one; a run cannot be computed.",
        errorCorrection: "Every blocker is named so the person knows exactly what to fix; nothing is computed with a missing figure.",
        recovery: { actionKey: "open-statutory-rates", routePath: "/finance/settings/statutory-rates" },
      },
      ready: {
        statePredicate: "Every figure is confirmed and every paid employee has a W-4 on file.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: SOURCE },
        essentialEvidenceKeys: ["who-is-paid", "pay-runs"],
        primaryExperience: { kind: "informational", messageKey: "payroll.ready" },
        prohibitedActionKeys: [],
        completionSignal: "The lead reads 'Payroll is ready to run' and points at the run form.",
        errorCorrection: "A computed run is a draft and can be recomputed for the same period until it is approved.",
        recovery: { actionKey: "compute-pay-run", routePath: ROUTE },
      },
    },
    taskProtocol: {
      startRoute: ROUTE,
      taskPrompt: "Run this month's payroll for the staff who are paid.",
      completionOracle:
        "A draft pay run for the month lists a payslip for each paid employee with federal income tax, Social Security and Medicare lines and employer FUTA and SUTA.",
      falseSuccessConditions: [
        "A run is computed while a tax figure is missing, withholding nothing for that tax.",
        "Every employee is withheld from one shared W-4 instead of their own.",
        "A US payslip shows National insurance.",
      ],
      acceptanceThresholds: [
        "No run can be computed while any blocker is listed.",
        "Each payslip's federal withholding follows that employee's own W-4.",
        "Nothing on the page approves a run or moves money.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-11-14" },
    reviewRef: "BI-099EAE30",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-099EAE30",
        summary:
          "On 2026-11-14 the founder asked for the thread's outcomes to be delivered: absorb Gusto so payroll can actually be run. Investigation found no page or action created a PayRun.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/hr/payroll-run.ts",
        summary:
          "runPayroll, computePayslip and the NACHA rail already existed. This page is their first caller, reading confirmed figures only.",
      },
    ],
  },
];
