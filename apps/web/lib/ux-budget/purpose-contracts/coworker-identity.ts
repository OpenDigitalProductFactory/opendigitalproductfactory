// Ratified page-purpose contract for /workforce/[agentId] — the Coworker
// Identity 360 (EP-COWORKER-IDENTITY-360, spec 2026-08-06). The purpose-identity
// ratchet refuses to grandfather a NEW route, so the identity surface arrives
// ratified. Shape mirrors right-now.ts.

import type { PurposeContractModule } from ".";

export const COWORKER_IDENTITY_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/workforce",
    intent: {
      primaryUser: "An operator who wants to reach AI coworkers as identities from the same place they reach People and Customers.",
      triggeringNeed:
        "Finding a specific AI coworker, or browsing the workforce, without going into the platform-admin AI section — the coworker directory as a business-domain peer to the People and Customer directories.",
      prerequisites: [
        "Signed in with the view_platform capability.",
        "At least one selectable coworker exists in the workforce registry.",
      ],
      job: "Browse or filter the AI coworkers and open one to see its identity.",
      successOutcome:
        "The operator sees the roster of coworkers with fitness-for-duty signals and opens one, landing on its Coworker Identity 360 at /workforce/[agentId].",
      findability: {
        parentArea: "AI Coworkers",
        entryPoints: ["Business nav: AI Coworkers (beside People and Customers)"],
        navigationLayer: "business section top-level",
        discoveryCue: "An 'AI Coworkers' entry beside People and Customers.",
        expectedPath: ["/workforce", "/workforce/[agentId]"],
      },
      contentRoles: {
        defaultVisibleKeys: ["roster-list", "roster-filters"],
        deferredRegions: [
          {
            key: "coworker-identity",
            role: "A single coworker's identity 360.",
            trigger: "Operator opens a coworker row.",
          },
        ],
      },
      familyConsistency: {
        terminology: "Coworker-facing role names and plain-language work — never raw agent ids or tool names.",
        actionLocation: "Filters sit above the roster; each row opens the coworker's identity.",
        feedbackPrimitive: "Inline filtering; no native dialogs.",
        disclosurePattern: "The roster shows by default; a coworker's full identity is one click away at /workforce/[agentId].",
        returnBehavior: "Opening a coworker navigates to its identity; the back path returns to the filtered roster.",
      },
    },
    stateScenarios: {
      "has-coworkers": {
        statePredicate: "At least one selectable coworker exists.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/coworker-record/roster.ts#loadRoster",
        },
        essentialEvidenceKeys: ["roster-list"],
        primaryExperience: { kind: "informational", messageKey: "workforce-directory.has-coworkers" },
        prohibitedActionKeys: [],
        completionSignal: "The roster lists coworkers, each row opening /workforce/[agentId].",
        errorCorrection: "An empty roster states no coworkers are selectable rather than showing a blank list.",
        recovery: { actionKey: "open-admin-overview", routePath: "/platform/ai/overview" },
      },
    },
    taskProtocol: {
      startRoute: "/workforce",
      taskPrompt: "Find a coworker and open its identity.",
      completionOracle: "The operator opens a coworker row and lands on /workforce/[agentId].",
      falseSuccessConditions: [
        "The operator is teleported into the platform-admin AI section instead of a coworker identity.",
        "A raw agentId is shown instead of the role name.",
      ],
      acceptanceThresholds: [
        "The roster is reachable from the business nav beside People and Customers.",
        "Each row opens the coworker's identity at /workforce/[agentId].",
      ],
    },
    ratifiedBy: { role: "owner", ref: "operator-request:mark-bodman-2026-08-11" },
    reviewRef: "EP-COWORKER-IDENTITY-360",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-COWORKER-IDENTITY-360",
        summary:
          "Founder asked to put AI Coworkers beside People and Customers (business nav) so employees reach coworkers as identities, not only via platform admin. Kernel decision DI-CB054DD6F79D.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/app/(shell)/platform/ai/overview/page.tsx",
        summary:
          "The platform overview already renders the roster (loadRoster + RosterView) with admin health/coverage panels; this business directory reuses the same roster read-model without the admin panels.",
      },
    ],
  },
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/workforce/[agentId]",
    intent: {
      primaryUser: "A platform operator looking at one AI coworker as a first-class identity, the way they look at a person or a customer.",
      triggeringNeed:
        "Seeing everything about one AI coworker in a single place — what it does and why it's valuable, who has engaged it, what it costs, and its skills — and adjusting how it behaves, without hopping across platform-admin surfaces.",
      prerequisites: [
        "Signed in with the view_platform capability (managing behaviour dials additionally requires manage_platform).",
        "The coworker exists in the workforce registry.",
      ],
      job: "Inspect a coworker's identity — definition, engagements, cost, skills — and set its priority and proactivity in place.",
      successOutcome:
        "The operator can state what the coworker does and why it's here, see which people and other agents have engaged it, read what it has cost, and change its Cost/Quality/Time priority and proactivity from this one surface.",
      findability: {
        parentArea: "AI Coworkers",
        entryPoints: ["/platform/ai/overview", "AI Coworkers roster row"],
        navigationLayer: "AI Coworkers directory drill-in",
        discoveryCue: "Selecting a coworker from the roster opens its identity.",
        expectedPath: ["/platform/ai/overview", "/workforce/[agentId]"],
      },
      contentRoles: {
        defaultVisibleKeys: ["definition-header", "at-a-glance", "who-engaged-it", "cost"],
        deferredRegions: [
          {
            key: "priority-control",
            role: "The Cost/Quality/Time priority control (Golden Triangle + inheritance).",
            trigger: "Operator activates 'Change' on the Priority setting.",
          },
          {
            key: "proactivity-control",
            role: "The Quiet/Balanced/Assertive proactivity control and its runtime effects.",
            trigger: "Operator activates 'Change' on the Proactivity setting.",
          },
          {
            key: "facet-detail",
            role: "Full facet bodies (cost drivers, engagement list, skills).",
            trigger: "Operator opens a collapsed facet summary.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Coworker-facing role names and plain-language outcomes — 'who has engaged it', 'what it cost' — never raw tool names or agent ids.",
        actionLocation:
          "Ask and Manage sit in the identity header; behaviour dials sit directly below the at-a-glance band; each facet expands in place.",
        feedbackPrimitive:
          "Inline text status (the priority control's saving/saved line) — no native dialogs.",
        disclosurePattern:
          "Definition and the at-a-glance summary show by default; settings show only their current value until 'Change'; facets show a one-line summary until opened.",
        returnBehavior:
          "Expanding a facet or a dial reveals detail in place without leaving the route; 'Manage' deep-links to the admin record for edits beyond the dials.",
      },
    },
    stateScenarios: {
      "no-activity": {
        statePredicate: "The coworker has no recorded engagements and no recorded spend in the window.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/coworker-identity/engagements-projection.ts#loadCoworkerEngagements",
        },
        essentialEvidenceKeys: ["definition-header", "at-a-glance"],
        primaryExperience: {
          kind: "informational",
          messageKey: "coworker-identity.no-activity",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The definition and at-a-glance band render; the engagements and cost facets state plainly that nothing has been recorded yet.",
        errorCorrection:
          "An empty engagements facet states that no one has engaged the coworker yet, rather than showing a blank region.",
        recovery: {
          actionKey: "open-admin-record",
          routePath: "/platform/ai/agent/[agentId]",
        },
      },
      "has-activity": {
        statePredicate: "The coworker has recorded engagements and/or spend in the window.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/coworker-identity/cost-projection.ts#loadCoworkerCostProjection",
        },
        essentialEvidenceKeys: ["who-engaged-it", "cost", "at-a-glance"],
        primaryExperience: {
          kind: "informational",
          messageKey: "coworker-identity.has-activity",
        },
        prohibitedActionKeys: [],
        completionSignal:
          "The engagements facet distinguishes people from other agents with recency; the cost facet shows spend, trend, drivers, and budget posture.",
        errorCorrection:
          "A read hiccup on cost or engagements fails open to an empty-state facet rather than 500-ing the identity.",
        recovery: {
          actionKey: "open-admin-record",
          routePath: "/platform/ai/agent/[agentId]",
        },
      },
    },
    taskProtocol: {
      startRoute: "/workforce/[agentId]",
      taskPrompt: "Tell me what this coworker does, who has engaged it, and what it has cost — then set its priority to Quality first.",
      completionOracle:
        "The operator reads the definition, names a person and an agent that engaged it, reads the 30-day cost, and changes the priority to Quality first.",
      falseSuccessConditions: [
        "The operator reads a raw agentId instead of the role name.",
        "Token totals are mistaken for accomplishment or for dollar cost.",
        "The operator leaves to the admin record to read cost or engagements that belong on the identity.",
      ],
      acceptanceThresholds: [
        "The definition (what it does / why valuable) is legible at the top without scrolling into a facet.",
        "People and other agents that engaged it are visually distinguishable.",
        "Priority and proactivity are changeable in place, showing inheritance / current value first.",
      ],
    },
    ratifiedBy: {
      role: "owner",
      ref: "operator-request:mark-bodman-2026-08-06",
    },
    reviewRef: "BI-COWORKER-360-PAGE",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "EP-COWORKER-IDENTITY-360",
        summary:
          "Founder asked for a single place to see an AI coworker as an identity (definition, engagements, costs, skills) and drill in — the way People and Customers work — for employees and other AI use-cases.",
      },
      {
        kind: "existing-behavior",
        ref: "apps/web/lib/coworker-record/load-record.ts",
        summary:
          "The admin coworker record already aggregates the coworker's facets but is positioned as platform administration; this identity surface reuses its loader and the canonical priority/proactivity controls.",
      },
    ],
  },
];
