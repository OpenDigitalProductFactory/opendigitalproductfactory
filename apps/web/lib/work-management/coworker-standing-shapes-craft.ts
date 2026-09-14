// Coworker standing shapes — the read-and-propose craft roles.
//
// WHY A THIRD FILE. coworker-standing-shapes.ts is at its 800-LOC ceiling and
// -operate.ts holds the operate stream. THIS FILE MUST BE LISTED IN
// `SHAPE_SOURCE_FILES` (scripts/measure-capability-completeness.mjs) — a
// registry spanning files the measure does not read is the defect found four
// times in this codebase, and a guard test now fails the build on a
// work-management file that declares an accountable agent and is not listed.
//
// WHAT THESE THREE SHARE. Each is deliberately READ-AND-PROPOSE: their authored
// grants withhold the write that would let them act on their own findings, and
// each shape's closing gate belongs to a human role. That is not a limitation
// worked around — it is the bound being declared. A shape that let one of these
// commit its own finding would contradict the grant map that defines it.

import type { WorkShapeDefinition } from "./work-shapes";

export const COWORKER_STANDING_SHAPES_CRAFT: Record<string, WorkShapeDefinition> = {
  // ── UX Design Critic (AGT-906) ────────────────────────────────────────────
  //
  // Grant intent is unusually explicit (coworker-grants.ts): "READ-AND-DRAFT
  // ONLY, deliberately. Absent by design: backlog_write / backlog_triage
  // (cannot file its own work), build_phase_advance / build_promote /
  // release_gate_create (cannot block or advance a build). The curation stage
  // carries NO gating authority because an ungrounded design critic is the
  // zero-shot judge UICrit measured at 13.1% comment validity — a critic that
  // can block on invalid findings trains the org to ignore the UX signal."
  //
  // So the shape must NOT end in the critic gating anything. It ends in a human
  // deciding which findings are real. The 13.1% number is why the budget stop
  // exists: a critic emitting an unbounded finding list is the failure mode.
  "ux-critique-pass": {
    key: "ux-critique-pass",
    version: "1.0.0",
    title: "UX critique pass",
    description:
      "Reasons over rendered screens against the founder critique corpus and returns grounded, "
      + "cited findings. It files nothing and blocks nothing: a human decides which findings are "
      + "real and what becomes work.",
    triggers: ["claim", "cadence"],
    stages: [
      {
        key: "observe",
        title: "Observe the rendered surface",
        accountablePrincipalRef: "agent:ux-design-critic",
        advance: {
          kind: "status-change",
          condition:
            "The screens under review are captured and identified by route. A critique of a surface "
            + "nobody can point at is not reviewable.",
        },
        evidence: ["screen-capture-set"],
      },
      {
        key: "ground",
        title: "Ground each finding in the critique corpus",
        accountablePrincipalRef: "agent:ux-design-critic",
        advance: {
          kind: "status-change",
          condition:
            "Every finding cites the corpus principle it rests on. An uncited finding is dropped "
            + "rather than carried — ungrounded criticism is the measured failure mode this role "
            + "was scoped around.",
        },
        evidence: ["cited-finding-list"],
      },
      {
        key: "adjudicate",
        title: "Decide which findings are real",
        // The critic drafts; a human adjudicates. Critic gating authority is a
        // LATER staged grant, gated on measured agreement against a held-out
        // founder-corpus slice — it is deliberately not assumed here.
        accountablePrincipalRef: "role:design-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "A human accepts, amends, or rejects each finding. Accepted findings become work through "
            + "the normal intake; the critic does not file them.",
          decisionScope: "ux-critique-adjudication",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every finding is adjudicated by a human, accepted or rejected." },
      {
        kind: "failure",
        condition:
          "The surface cannot be rendered or the corpus cannot be read. The pass stops rather than "
          + "critiquing from memory — an ungrounded critic is the thing this role must not become.",
      },
      {
        kind: "budget",
        condition:
          "More than 30 findings in one pass — stop and escalate. An unbounded finding list is how "
          + "a UX signal gets ignored, which is the outcome this shape exists to prevent.",
      },
    ],
    grants: ["tool:browser_read", "tool:coworker_screen_read", "tool:document_read", "tool:document_write", "tool:spec_plan_read", "tool:backlog_read"],
    measures: [
      { key: "finding-acceptance-rate", description: "Share of findings a human accepted — the agreement signal that gates any future critic authority." },
      { key: "surfaces-reviewed", description: "Distinct routes critiqued in one cycle." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 30, unit: "findings" }],
    reviewPoint: {
      everyDays: 30,
      description:
        "Monthly. Acceptance rate is the measure that matters: a critic whose findings are mostly "
        + "rejected is training the org to ignore it, and should be retuned or stood down.",
    },
    collaborationShape: "specialist-alignment",
  },

  // ── Market Research Analyst (AGT-WS-MARKET-RESEARCH) ──────────────────────
  //
  // Grants: web_search, crm_read, registry_read (coworker-grants.ts). The intent
  // note is explicit that this is "read-and-propose: it returns the cited brief
  // in conversation and may file a governed CRM enrichment proposal, but holds
  // neither document_write nor registry_write", and that it is owner-facing
  // market research, NOT the feature-scoped Build-Studio research launchers.
  "market-research-brief": {
    key: "market-research-brief",
    version: "1.0.0",
    title: "Market research brief",
    description:
      "Answers an owner's market question with a cited brief drawn from public sources and the "
      + "org's own CRM context. It proposes; it does not mutate the pipeline and does not write to "
      + "the knowledge base.",
    triggers: ["claim"],
    stages: [
      {
        key: "frame",
        title: "Frame the question against what the org already knows",
        accountablePrincipalRef: "agent:market-research-analyst",
        advance: {
          kind: "status-change",
          condition:
            "The question is stated in terms of a decision the owner faces, and existing CRM "
            + "context is read before any external search.",
        },
        evidence: ["research-question"],
      },
      {
        key: "research",
        title: "Gather and cite",
        accountablePrincipalRef: "agent:market-research-analyst",
        advance: {
          kind: "status-change",
          condition:
            "Every claim in the brief carries its source. An uncited claim is removed, not softened.",
        },
        evidence: ["cited-brief"],
      },
      {
        key: "act-on-it",
        title: "Decide what the brief changes",
        // The analyst holds crm_read, never crm_write. Any pipeline change is a
        // governed enrichment PROPOSAL a human accepts.
        accountablePrincipalRef: "role:commercial-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "The owner decides what the brief changes — including nothing. Any CRM change goes "
            + "through the governed enrichment proposal path, never a direct write.",
          decisionScope: "market-research-adoption",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The owner has a cited brief and has decided what, if anything, it changes." },
      {
        kind: "failure",
        condition:
          "The question cannot be grounded in a decision the owner actually faces. Stop and ask "
          + "rather than returning research nobody will use.",
      },
      { kind: "budget", condition: "More than 40 external sources in one brief — stop and narrow the question." },
    ],
    grants: ["tool:web_search", "tool:crm_read", "tool:registry_read"],
    measures: [
      { key: "briefs-acted-on", description: "Share of briefs that changed an owner decision." },
      { key: "citation-density", description: "Claims carrying a source, as a share of all claims." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 40, unit: "sources" }],
    reviewPoint: {
      everyDays: 90,
      description:
        "Quarterly. A research role whose briefs never change a decision is answering the wrong "
        + "questions, not answering them badly.",
    },
    collaborationShape: "specialist-alignment",
  },

  // ── MCP & Integration Engineer (AGT-WS-INTEGRATION) ───────────────────────
  //
  // Grant intent (coworker-grants.ts, BI-CC44E74F): "must match the
  // establish_coworker factory-door grants exactly. registry_read reaches the
  // WSID craft-decision path; tool_script_exec supports programmatic review of
  // the tool surface." Reviewing the tool surface is the standing work; adopting
  // anything into it is governed — an unvetted external tool is a §7 refusal.
  "integration-surface-review": {
    key: "integration-surface-review",
    version: "1.0.0",
    title: "Integration surface review",
    description:
      "Keeps the MCP and integration surface honest: what is exposed, what is reachable, what has "
      + "drifted from its contract. Adoption of anything new is a governed decision, never a "
      + "consequence of the review finding it useful.",
    triggers: ["cadence", "claim"],
    stages: [
      {
        key: "inventory",
        title: "Inventory what is actually exposed",
        accountablePrincipalRef: "agent:integration-engineer",
        advance: {
          kind: "status-change",
          condition:
            "The live tool and integration surface is enumerated from the running registry, not "
            + "from documentation. Documentation drift is itself a finding.",
        },
        evidence: ["surface-inventory"],
      },
      {
        key: "assess",
        title: "Assess reachability and contract drift",
        accountablePrincipalRef: "agent:integration-engineer",
        advance: {
          kind: "status-change",
          condition:
            "Each exposure is classed reachable, unreachable, or drifted from its declared "
            + "contract, with the evidence that decided it. An exposure nothing can reach is "
            + "reported, not quietly retired.",
        },
        evidence: ["drift-report"],
      },
      {
        key: "authorize",
        title: "Authorize adoption, change or retirement",
        // Adopting an external tool is a governed evaluation (AGENTS.md §7):
        // security, architecture fit, compliance, integration. The engineer
        // prepares that case; it does not decide it.
        accountablePrincipalRef: "role:platform-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "A platform owner authorizes each adoption, contract change or retirement. An unvetted "
            + "external tool is refused at this gate, not adopted because the review found it useful.",
          decisionScope: "integration-surface-authorization",
        },
        evidence: ["decision-record", "tool-evaluation"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every drifted or unreachable exposure has an owner decision against it." },
      {
        kind: "failure",
        condition:
          "The live registry cannot be read. The review stops rather than reporting a surface "
          + "inventory assembled from documentation, which is the drift it exists to detect.",
      },
      { kind: "budget", condition: "More than 60 drifted exposures in one cycle — stop and escalate; that is a migration, not a review." },
    ],
    grants: ["tool:registry_read", "tool:tool_script_exec", "tool:document_read", "tool:backlog_read"],
    measures: [
      { key: "drift-closed", description: "Drifted exposures resolved by an owner decision." },
      { key: "unreachable-exposures", description: "Declared integrations nothing can actually reach." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 60, unit: "exposures" }],
    reviewPoint: {
      everyDays: 90,
      description:
        "Quarterly, matching the 90-day reference-staleness ceiling — an integration surface "
        + "unreviewed for longer is one nobody can vouch for.",
    },
    collaborationShape: "change-consequential",
  },
};
