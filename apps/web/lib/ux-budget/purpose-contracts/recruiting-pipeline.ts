// Ratified page-purpose contract for /employee/recruiting (BI-9CC44DC7).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so the
// recruiting pipeline page arrives ratified. Shape mirrors right-now.ts. This
// is the human-facing surface of the getRecruitingPipeline read model whose
// coworker tool shipped in BI-E64D11AE.

import type { PurposeContractModule } from ".";

export const RECRUITING_PIPELINE_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/employee/recruiting",
    intent: {
      primaryUser: "An HR or recruiting operator with the view_employee capability.",
      triggeringNeed:
        "Seeing the whole recruiting funnel across natively-created applications and Greenhouse-sourced candidates as one list — without logging into two systems or reconciling duplicates by hand.",
      prerequisites: [
        "Signed in with the view_employee capability (the Employee area gate).",
        "Recruiting data exists: native Applications and/or Greenhouse-staged application records imported through the connector.",
      ],
      job: "Scan the unified recruiting funnel, read how many candidates are native versus sourced-from-Greenhouse-and-not-yet-promoted, see the shape by stage, and narrow to a single requisition.",
      successOutcome:
        "The operator sees one deduped funnel, reads the native / Greenhouse / total counts and the by-stage summary, can filter to a single requisition, and can tell a native candidate from a Greenhouse-sourced one at a glance.",
      findability: {
        parentArea: "Employee",
        entryPoints: ["/employee", "Employee > Recruiting"],
        navigationLayer: "Employee area secondary nav",
        discoveryCue: "A 'Recruiting' entry in the Employee area, beside the People directory.",
        expectedPath: ["/employee", "/employee/recruiting"],
      },
      contentRoles: {
        defaultVisibleKeys: [
          "funnel-counts",
          "stage-summary",
          "candidate-list",
          "requisition-filter",
        ],
        deferredRegions: [],
      },
      familyConsistency: {
        terminology:
          "Candidate display names and source labels ('Native', 'Greenhouse') — never raw external ids or connector internals.",
        actionLocation:
          "The requisition filter sits above the candidate list; changing it re-reads the funnel in place.",
        feedbackPrimitive:
          "Inline pending state on the list while the filtered funnel re-reads — no native dialogs.",
        disclosurePattern:
          "Counts, stage summary, and the full funnel show by default; the requisition filter narrows the same list rather than revealing a new surface.",
        returnBehavior:
          "Selecting 'All requisitions' restores the full funnel without leaving the route.",
      },
    },
    stateScenarios: {
      "empty-funnel": {
        statePredicate: "No native Applications and no un-promoted Greenhouse-staged rows exist.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/recruiting/pipeline-read-model.ts#getRecruitingPipeline",
        },
        essentialEvidenceKeys: ["funnel-counts"],
        primaryExperience: {
          kind: "informational",
          messageKey: "recruiting-pipeline.empty",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The count trio reads zero and an empty-state message explains that native and Greenhouse-sourced candidates will appear here as they arrive.",
        errorCorrection:
          "The empty state names both sources so the operator knows nothing is hidden — the funnel is genuinely empty, not mis-filtered.",
        recovery: {
          actionKey: "open-people-directory",
          routePath: "/employee",
        },
      },
      "populated-funnel": {
        statePredicate: "At least one native Application or un-promoted Greenhouse-staged row exists.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/recruiting/pipeline-read-model.ts#getRecruitingPipeline",
        },
        essentialEvidenceKeys: ["funnel-counts", "candidate-list", "stage-summary"],
        primaryExperience: {
          kind: "informational",
          messageKey: "recruiting-pipeline.populated",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "Each candidate row shows a source badge (Native or Greenhouse), stage, and status; the counts and stage chips reconcile with the list.",
        errorCorrection:
          "A candidate imported from Greenhouse and already promoted appears once (native), never twice — the crosswalk dedupe is visible in the counts.",
        recovery: {
          actionKey: "clear-requisition-filter",
          routePath: "/employee/recruiting",
        },
      },
      "filtered-empty": {
        statePredicate: "A requisition is selected but has no applications in the funnel.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/recruiting/pipeline-read-model.ts#getRecruitingPipeline",
        },
        essentialEvidenceKeys: ["requisition-filter", "funnel-counts"],
        primaryExperience: {
          kind: "informational",
          messageKey: "recruiting-pipeline.filtered-empty",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The list is empty and the message points to clearing the requisition filter to see the full funnel.",
        errorCorrection:
          "The empty state distinguishes 'this requisition has no candidates' from 'the funnel is empty' so the operator clears the filter rather than concluding recruiting is idle.",
        recovery: {
          actionKey: "clear-requisition-filter",
          routePath: "/employee/recruiting",
        },
      },
    },
    taskProtocol: {
      startRoute: "/employee/recruiting",
      taskPrompt:
        "Show me the recruiting funnel and tell me how many candidates came from Greenhouse but haven't been promoted to native yet.",
      completionOracle:
        "The operator reads the 'From Greenhouse' count and can point to Greenhouse-badged rows in the list.",
      falseSuccessConditions: [
        "The operator counts a promoted (native) candidate as a Greenhouse one.",
        "The requisition filter is mistaken for a search over all candidates rather than a narrowing to one role.",
        "An empty filtered list is read as an empty funnel.",
      ],
      acceptanceThresholds: [
        "Native and Greenhouse-sourced candidates are distinguishable at a glance via the source badge.",
        "The funnel counts reconcile with the visible list.",
        "The page performs no write action — it is a read-only funnel.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:mark-bodman-2026-08-06",
    },
    reviewRef: "BI-9CC44DC7",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-9CC44DC7",
        summary:
          "Founder selected the visual recruiting pipeline page as the next absorption chunk and signed off an HTML prototype: a read-only funnel with count trio, by-stage summary, source-badged candidate list, and a requisition filter.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/recruiting/pipeline-read-model.ts",
        summary:
          "getRecruitingPipeline already merges native Applications with Greenhouse-staged rows and dedupes via the MasterDataSourceRef crosswalk; the coworker tool (BI-E64D11AE) surfaces it to the AI workforce. This page is its human-facing surface, reading the same model so the two never drift.",
      },
    ],
  },
];
