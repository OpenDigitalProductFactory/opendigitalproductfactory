// Ratified page-purpose contract for /platform/ai/right-now (BI-1A68257F).
//
// The purpose-identity ratchet refuses to grandfather a NEW route, so the
// workforce "Right Now" view arrives ratified. Shape mirrors graph-explorer.ts.

import type { PurposeContractModule } from ".";

export const RIGHT_NOW_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/platform/ai/right-now",
    intent: {
      primaryUser: "A platform operator supervising the AI coworker workforce.",
      triggeringNeed:
        "Seeing what the AI coworkers are doing right now and what they got done today — and where nobody is acting — without leaving to read logs or opening HR-sensitive records.",
      prerequisites: [
        "Signed in with the view_platform capability.",
        "The workforce roster is seeded and coworkers have produced TaskRun / ToolExecution / TokenUsage activity.",
      ],
      job: "Scan the coworker workforce, see who is active and what they accomplished, and spot idle coworkers or missing human owners.",
      successOutcome:
        "The operator can name which coworkers are working, read each one's outcomes for the day, see the responsible human, and notice where activity is absent — all as aggregate signals, never sensitive record content.",
      findability: {
        parentArea: "AI Operations",
        entryPoints: ["/platform/ai", "AI Operations > Right Now"],
        navigationLayer: "AI Operations secondary nav",
        discoveryCue: "A 'Right Now' tab beside Workforce and Operations Map.",
        expectedPath: ["/platform/ai/overview", "/platform/ai/right-now"],
      },
      contentRoles: {
        defaultVisibleKeys: ["workforce-pulse", "working-now-list", "platform-work-list", "quiet-list"],
        deferredRegions: [
          {
            key: "coworker-manage",
            role: "Per-coworker manage jump-offs (settings, priority and models, skills and grants, schedule).",
            trigger: "Operator activates 'Manage' on a coworker.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Coworker-facing names and business outcomes — '3 PRs opened', 'employee records updated' — never raw tool names.",
        actionLocation:
          "Manage jump-offs sit on each coworker row; refresh sits in the freshness bar above the roster.",
        feedbackPrimitive:
          "Inline text status (refreshing, last-updated age) — no native dialogs.",
        disclosurePattern:
          "Working and quiet coworkers show by default; per-coworker management stays behind 'Manage'.",
        returnBehavior:
          "Refresh re-fetches the snapshot in place without leaving the route.",
      },
    },
    stateScenarios: {
      "all-idle": {
        statePredicate: "No coworker has an active or waiting TaskRun.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/platform-runtime/workforce-activity.ts#loadWorkforceActivity",
        },
        essentialEvidenceKeys: ["workforce-pulse", "quiet-list"],
        primaryExperience: {
          kind: "informational",
          messageKey: "right-now.all-idle",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The Working-now list is empty and the quiet list shows every coworker with its last-acted age.",
        errorCorrection:
          "An empty working list states that no coworker is active and points to the quiet list for how long each has been idle.",
        recovery: {
          actionKey: "open-operations-map",
          routePath: "/platform/ai/operations-map",
        },
      },
      "active-work": {
        statePredicate: "At least one coworker has a live TaskRun.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/platform-runtime/workforce-activity.ts#loadWorkforceActivity",
        },
        essentialEvidenceKeys: ["working-now-list", "workforce-pulse"],
        primaryExperience: {
          kind: "informational",
          messageKey: "right-now.active-work",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "Each working coworker shows its current task, today's outcome chips, tokens, and responsible human.",
        errorCorrection:
          "Sensitive-data activity renders as an aggregate flag with no drill-in, so no record content is exposed to a non-HR operator.",
        recovery: {
          actionKey: "refresh-now",
          routePath: "/platform/ai/right-now",
        },
      },
    },
    taskProtocol: {
      startRoute: "/platform/ai/right-now",
      taskPrompt: "Tell me which coworker did the most today and who is responsible for it.",
      completionOracle:
        "The operator names a coworker from the Working-now list with its outcome chips and reads its human owner.",
      falseSuccessConditions: [
        "The operator reads a coworker name from the idle roster instead of the working list.",
        "Sensitive record content is expected instead of the aggregate count and flag.",
        "Token totals are mistaken for accomplishment outcomes.",
      ],
      acceptanceThresholds: [
        "No sensitive record content is shown to a non-HR operator.",
        "Idle coworkers are distinguishable from working ones at a glance.",
        "Each coworker's human owner (or its absence) is legible.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:mark-bodman-2026-08-05",
    },
    reviewRef: "BI-1A68257F",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-1A68257F",
        summary:
          "Founder asked for a workforce view showing what AI coworkers are doing and have accomplished, with inactivity as a signal, sensitive-data as an aggregate flag only, and the responsible human surfaced.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/ai-operations-map/load-map-data.ts",
        summary:
          "The Operations Map already loads TaskRun / ToolExecution / TokenUsage but presents them as an analytical topology/replay surface, not a workforce-activity roster.",
      },
    ],
  },
];
