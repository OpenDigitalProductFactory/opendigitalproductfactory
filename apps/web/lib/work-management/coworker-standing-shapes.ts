// Coworker standing shapes (BI-82902891 follow-on; capability-completeness shape plane).
//
// standing-operations-shapes.ts declares the shapes a BUSINESS runs. This
// module declares the shapes the platform's own active-roster coworkers run —
// the standing work that makes a Proactivity setting mean something. Split for
// the same reason that file was: the contract module stays under its size
// ratchet, and a new shape never edits the rules that govern it.
//
// Every stage names a real accountable principal, and every shape ends in a
// governed decision taken by a HUMAN ROLE, never by the coworker that prepared
// it. That is the §8.11.2 rule and it is the whole point: a shape bounds what
// standing work may do, so a shape whose gates are all status-changes would
// declare an unbounded coworker in the shape of a bounded one.
//
// Stages are drawn from each coworker's authored persona (prompts/route-persona)
// where one exists, and from its registry role and value stream where one does
// not — not invented from the slug.
//
// GRANTS ARE CAPPED. `specialization-over-generalization` (core kernel):
// no more than 10 tools relevant to the current task, degrading past 15
// "regardless of model capability". Shape-scoped grants are how a coworker
// holding several shapes still activates with a small set.

import type { WorkShapeDefinition } from "./work-shapes";

export const COWORKER_STANDING_SHAPES: Record<string, WorkShapeDefinition> = {
  // ── operate / security ────────────────────────────────────────────────────
  "security-alert-triage-ladder": {
    key: "security-alert-triage-ladder",
    version: "1.0.0",
    title: "Security alert triage ladder",
    description:
      "A detection is enriched, given an evidence-backed verdict, escalated when it exceeds "
      + "Tier-1, and scoped. Response actions are PROPOSED to the customer, never executed: the "
      + "ladder ends on the customer's Attention Surface.",
    triggers: ["claim", "escalation"],
    stages: [
      {
        key: "enrich",
        title: "Enrich the detection before it costs anyone attention",
        accountablePrincipalRef: "agent:soc-triage-analyst",
        advance: {
          kind: "status-change",
          condition: "Asset, identity, and threat-intel context are attached to the case.",
        },
        evidence: ["security-case-timeline"],
      },
      {
        key: "verdict",
        title: "Assign a verdict from the evidence",
        accountablePrincipalRef: "agent:soc-triage-analyst",
        advance: {
          // Deliberately NOT a governed decision. The persona is explicit that a
          // verdict is an evidence conclusion — the kernel never decides whether
          // something is malicious. Routing it through a gate would misplace the
          // judgement and slow every false positive.
          kind: "status-change",
          condition:
            "The case carries false-positive, benign-true-positive, malicious, or needs-human, "
            + "backed by named events rather than a guess.",
        },
        evidence: ["security-case-verdict"],
      },
      {
        key: "scope",
        title: "Reconstruct the timeline and blast radius",
        accountablePrincipalRef: "agent:soc-investigator",
        advance: {
          kind: "status-change",
          condition:
            "Timeline, implicated hosts and accounts, and ATT&CK techniques are named, or the "
            + "case is marked needs-human because the evidence will not support a call.",
        },
        evidence: ["security-case-timeline"],
      },
      {
        key: "authorize-response",
        title: "Authorize containment or remediation",
        // The commander drafts; the customer authorizes. The MSP never gains
        // standing execute rights on the customer's estate.
        accountablePrincipalRef: "role:security-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "The customer approves, rejects, or amends each proposed response action on their "
            + "own Attention Surface; execution happens on their runner.",
          decisionScope: "security-response-authorization",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The case reaches closed with a verdict and, where action was taken, an authorization record." },
      { kind: "failure", condition: "Detection, asset, or identity context cannot be read — the ladder stops and reports rather than assigning a verdict from an empty read." },
      { kind: "budget", condition: "More than 100 cases in one cycle — the ladder stops and escalates rather than triaging a queue nobody can review." },
    ],
    grants: ["tool:read", "tool:security_case_write", "tool:threat_intel_lookup"],
    measures: [
      { key: "cases-judged", description: "Cases given an evidence-backed verdict in one cycle." },
      { key: "escalation-rate", description: "Share of cases that left Tier-1." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "cases" }],
    reviewPoint: {
      everyDays: 30,
      description:
        "Reviewed monthly whether or not it escalated: a ladder that has escalated nothing is as "
        + "likely to be mis-tuned as to be reassuring.",
    },
    collaborationShape: "escalation",
  },

  "detection-coverage-hunt": {
    key: "detection-coverage-hunt",
    version: "1.0.0",
    title: "Detection coverage hunt",
    description:
      "Named ATT&CK and asset-class coverage gaps, structured hypothesis hunts against them, and "
      + "proposed detection content. The hunter proposes rules; an operator activates them.",
    triggers: ["cadence", "estate-drift"],
    stages: [
      {
        key: "gap-scan",
        title: "Name the coverage gaps",
        accountablePrincipalRef: "agent:soc-threat-hunter",
        advance: {
          kind: "status-change",
          condition: "Techniques and asset classes with no detection are enumerated, not characterised.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "hunt",
        title: "Run the hypothesis hunt",
        accountablePrincipalRef: "agent:soc-threat-hunter",
        advance: {
          kind: "status-change",
          condition: "Each hunt records what was looked for and what was found, including when nothing was.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "activate-content",
        title: "Activate proposed detection content",
        accountablePrincipalRef: "role:security-owner",
        advance: {
          kind: "governed-decision",
          condition: "An operator reviews each proposed rule tuning and activates, amends, or declines it.",
          decisionScope: "detection-content-activation",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every named gap has either proposed content or a recorded reason it was not pursued." },
      { kind: "failure", condition: "The detection or threat-intel index cannot be read — the hunt reports rather than declaring the estate clean." },
      { kind: "budget", condition: "More than 25 proposals in one cycle — content nobody can review is not coverage." },
    ],
    grants: ["tool:read", "tool:threat_intel_lookup", "tool:detection_rule_propose"],
    measures: [
      { key: "gaps-named", description: "Coverage gaps enumerated in one cycle." },
      { key: "content-activated", description: "Proposed rules an operator activated." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 25, unit: "proposals" }],
    reviewPoint: { everyDays: 30, description: "A hunt that proposes nothing for a month is reviewed, not trusted." },
    collaborationShape: "craft-stewardship",
  },

  // ── estate and data stewardship ───────────────────────────────────────────
  "estate-conformance-watch": {
    key: "estate-conformance-watch",
    version: "1.0.0",
    title: "Estate conformance watch",
    description:
      "The recorded estate is compared with what the platform can actually observe — schema, "
      + "assets, and architecture — and each divergence is raised for an accountable decision. "
      + "It reports drift; it does not reconcile the record to the observation on its own.",
    triggers: ["cadence", "estate-drift"],
    stages: [
      {
        key: "sweep",
        title: "Read the estate as recorded and as observed",
        accountablePrincipalRef: "agent:data-steward",
        advance: {
          kind: "status-change",
          condition: "Both readings completed for every asset class in scope, with unreadable classes named.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "assess",
        title: "Assess each divergence",
        accountablePrincipalRef: "agent:data-architect",
        advance: {
          kind: "status-change",
          condition:
            "Each divergence is classified as a record defect, an observation defect, or a genuine change, "
            + "with the evidence for the classification.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "inventory",
        title: "Reconcile the asset inventory",
        accountablePrincipalRef: "agent:inventory-specialist",
        advance: {
          kind: "status-change",
          condition: "Assets present in one reading and absent from the other are listed with their last-seen evidence.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "accept-or-remediate",
        title: "Decide the response to the drift",
        accountablePrincipalRef: "role:data-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner accepts the observed state, remediates it, or defers with a date.",
          decisionScope: "estate-drift-response",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every divergence carries a classification and an owner decision." },
      { kind: "failure", condition: "Either reading is unavailable — the watch stops rather than reporting an empty diff as conformance." },
      { kind: "budget", condition: "More than 200 divergences — the watch escalates the scale rather than filing them one by one." },
    ],
    grants: ["tool:read", "tool:schema_describe", "tool:asset_inventory_read"],
    measures: [
      { key: "divergences-raised", description: "Divergences classified in one sweep." },
      { key: "unreadable-classes", description: "Asset classes that could not be read — a zero here is what makes the sweep meaningful." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 200, unit: "divergences" }],
    reviewPoint: { everyDays: 30, description: "Monthly: a sweep reporting no drift for a month is checked for a broken reading first." },
    collaborationShape: "specialist-alignment",
  },

  "architecture-alignment-review": {
    key: "architecture-alignment-review",
    version: "1.0.0",
    title: "Architecture alignment review",
    description:
      "Standing review of where the delivered architecture has diverged from the recorded one, "
      + "raised as findings against named capabilities rather than as an opinion about the estate.",
    triggers: ["cadence", "authority-change"],
    stages: [
      {
        key: "compare",
        title: "Compare delivered against recorded architecture",
        accountablePrincipalRef: "agent:ea-architect",
        advance: {
          kind: "status-change",
          condition: "Each capability in scope is compared, and capabilities with no recorded architecture are named as such.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "ratify",
        title: "Ratify or reject the alignment finding",
        accountablePrincipalRef: "role:architecture-owner",
        advance: {
          kind: "governed-decision",
          condition: "The architecture owner ratifies the delivered state, orders remediation, or rejects the finding with a reason.",
          decisionScope: "architecture-alignment",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every compared capability has a ratified position." },
      { kind: "failure", condition: "The recorded architecture is unreadable — the review stops rather than treating absence as alignment." },
      { kind: "budget", condition: "More than 50 findings in one cycle." },
    ],
    grants: ["tool:read", "tool:ea_view_describe"],
    measures: [{ key: "capabilities-compared", description: "Capabilities compared in one cycle." }],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "findings" }],
    reviewPoint: { everyDays: 90, description: "Quarterly, matching the cadence at which recorded architecture is expected to move." },
    collaborationShape: "specialist-alignment",
  },

  // ── obligation and legal ──────────────────────────────────────────────────
  "licence-currency-watch": {
    key: "licence-currency-watch",
    version: "1.0.0",
    title: "Licence currency watch",
    description:
      "Acquired licensing requirements are re-confirmed against their issuing authority before "
      + "they pass the 90-day ceiling, and anything unconfirmed is surfaced as unconfirmed rather "
      + "than served as current. Complements the compliance officer's obligation sweep, which "
      + "watches dates rather than the currency of the rule behind them.",
    triggers: ["cadence", "evidence-decay"],
    stages: [
      {
        key: "re-verify",
        title: "Re-confirm requirements against the authority",
        accountablePrincipalRef: "agent:licensing-specialist",
        advance: {
          kind: "status-change",
          condition:
            "Every reference past or approaching its staleness budget is re-checked against its official "
            + "source, and the check's outcome is recorded whether or not the rule changed.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "determine",
        title: "Determine the legal position on a changed requirement",
        accountablePrincipalRef: "agent:legal-operations-counsel",
        advance: {
          kind: "status-change",
          condition: "Each changed requirement carries a jurisdiction-layered reading of what changed and for whom.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "adopt",
        title: "Adopt the changed requirement",
        accountablePrincipalRef: "role:compliance-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner adopts the revised requirement, disputes it, or defers with a review date.",
          decisionScope: "licensing-requirement-adoption",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No requirement in scope remains past its staleness budget without either a re-confirmation or an explicit unconfirmed marking." },
      { kind: "failure", condition: "The issuing authority's source is unreachable — the requirement is marked unconfirmed and the watch reports, rather than silently retaining the old text as current." },
      { kind: "budget", condition: "More than 100 re-verifications in one cycle." },
    ],
    grants: ["tool:read", "tool:web_search", "tool:licence_record_write"],
    measures: [
      { key: "references-reverified", description: "Requirements re-confirmed against their authority." },
      { key: "unconfirmed-remaining", description: "Requirements still never confirmed for this jurisdiction." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "requirements" }],
    reviewPoint: { everyDays: 30, description: "Monthly, well inside the 90-day currency ceiling it exists to defend." },
    collaborationShape: "approval-sign-off",
  },

  // ── workforce ─────────────────────────────────────────────────────────────
  "workforce-intake-cycle": {
    key: "workforce-intake-cycle",
    version: "1.0.0",
    title: "Workforce intake cycle",
    description:
      "A person joining, moving, or leaving is prepared end to end — records, access, equipment, "
      + "curriculum — and admitted by a human. The coworkers assemble the packet; they never grant "
      + "the access themselves.",
    triggers: ["claim", "deadline-horizon"],
    stages: [
      {
        key: "intake",
        title: "Assemble the intake packet",
        accountablePrincipalRef: "agent:admin-assistant",
        advance: {
          kind: "status-change",
          condition: "Start date, role, location, and required records are captured, with missing items named rather than assumed.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "prepare",
        title: "Prepare employment records and readiness",
        accountablePrincipalRef: "agent:hr-specialist",
        advance: {
          kind: "status-change",
          condition:
            "Employment records, role-based credential requirements, and the onboarding curriculum are "
            + "prepared, with any credential the role legally requires flagged as blocking.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "admit",
        title: "Admit the person to the workforce",
        accountablePrincipalRef: "role:people-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "A human admits the person, granting access and confirming any legally required credential "
            + "is held — never inferred from the packet being complete.",
          decisionScope: "workforce-admission",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The person is admitted, or the cycle is closed with a recorded reason." },
      { kind: "failure", condition: "A legally required credential is absent or unverifiable — the cycle stops at prepare and escalates; it does not proceed to admission." },
      { kind: "budget", condition: "More than 50 open intakes at once." },
    ],
    grants: ["tool:read", "tool:employee_record_write", "tool:curriculum_assign"],
    measures: [{ key: "intakes-completed", description: "Intakes carried to an admission decision." }],
    budgets: [{ kind: "cycles-per-window", limit: 50, unit: "open intakes" }],
    reviewPoint: { everyDays: 90, description: "Quarterly, or on any change to role-based credential requirements." },
    collaborationShape: "approval-sign-off",
  },

  "service-dispatch-cycle": {
    key: "service-dispatch-cycle",
    version: "1.0.0",
    title: "Service dispatch cycle",
    description:
      "Inbound service demand is scheduled against real technician availability and committed by "
      + "the operations coordinator. The dispatcher proposes an assignment; committing it to a "
      + "customer is a human act because it creates an external promise.",
    triggers: ["claim", "deadline-horizon"],
    stages: [
      {
        key: "assign",
        title: "Propose the assignment",
        accountablePrincipalRef: "agent:dispatcher",
        advance: {
          kind: "status-change",
          condition:
            "Each job has a proposed technician and window drawn from real availability, with conflicts "
            + "and unassignable jobs named rather than silently deferred.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "commit",
        title: "Commit the schedule",
        accountablePrincipalRef: "role:operations-owner",
        advance: {
          kind: "governed-decision",
          condition: "The coordinator commits the schedule, making the customer-facing promise explicit.",
          decisionScope: "service-schedule-commitment",
        },
        evidence: ["decision-record"],
      },
      {
        key: "coordinate",
        title: "Coordinate the day",
        accountablePrincipalRef: "agent:ops-coordinator",
        advance: {
          kind: "status-change",
          condition: "Running-late, reassignment, and completion states are reflected against the committed schedule.",
        },
        evidence: ["manual-check"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every job in the window is committed, deferred with a reason, or escalated as unassignable." },
      { kind: "failure", condition: "Technician availability cannot be read — the cycle stops rather than proposing a schedule against assumed capacity." },
      { kind: "budget", condition: "More than 300 jobs in one window." },
    ],
    grants: ["tool:read", "tool:schedule_write", "tool:customer_notify_propose"],
    measures: [
      { key: "jobs-committed", description: "Jobs committed in one window." },
      { key: "unassignable", description: "Jobs no available technician could take — the number that should reach a human." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 300, unit: "jobs" }],
    reviewPoint: { everyDays: 30, description: "Monthly, against actual completion versus committed windows." },
    collaborationShape: "specialist-alignment",
  },

  // ── outward-facing surfaces ───────────────────────────────────────────────
  "outward-surface-review": {
    key: "outward-surface-review",
    version: "1.0.0",
    title: "Outward surface review",
    description:
      "Anything the business shows the public — storefront copy, marketing content, documentation — "
      + "is reviewed for accuracy and accessibility before a human publishes it. Nothing here "
      + "publishes; publication is the governed act.",
    triggers: ["cadence", "authority-change"],
    stages: [
      {
        key: "draft",
        title: "Draft or revise the outward content",
        accountablePrincipalRef: "agent:marketing-specialist",
        advance: {
          kind: "status-change",
          condition: "Each claim in the draft is traceable to something the business actually offers.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "storefront-fit",
        title: "Check it against what the storefront actually sells",
        accountablePrincipalRef: "agent:storefront-advisor",
        advance: {
          kind: "status-change",
          condition: "Offers, prices, and availability in the content match the storefront record, or the mismatch is named.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "document",
        title: "Reconcile the documentation",
        accountablePrincipalRef: "agent:doc-specialist",
        advance: {
          kind: "status-change",
          condition: "User-facing documentation affected by the change is updated, or recorded as unaffected with a reason.",
        },
        evidence: ["manual-check"],
      },
      {
        key: "accessibility",
        title: "Accessibility review",
        accountablePrincipalRef: "agent:ux-accessibility-agent",
        advance: {
          kind: "status-change",
          condition:
            "Text alternatives, contrast, and semantic structure are checked; failures are named as "
            + "blocking rather than advisory.",
        },
        evidence: ["ux-verified"],
      },
      {
        key: "publish",
        title: "Publish",
        accountablePrincipalRef: "role:marketing-owner",
        advance: {
          kind: "governed-decision",
          condition: "A human publishes, holds, or rejects. Outward publication is never an agent act.",
          decisionScope: "outward-content-publication",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The content is published or withdrawn, with the accessibility outcome recorded either way." },
      { kind: "failure", condition: "A blocking accessibility failure stands — the shape stops at review and does not reach publish." },
      { kind: "budget", condition: "More than 20 items in one review cycle." },
    ],
    grants: ["tool:read", "tool:content_draft_write", "tool:accessibility_check"],
    measures: [
      { key: "items-published", description: "Items a human published in one cycle." },
      { key: "accessibility-blocks", description: "Items stopped by a blocking accessibility failure." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 20, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly; accessibility standards and the storefront both move." },
    collaborationShape: "outward-review",
  },

  "external-build-handoff": {
    key: "external-build-handoff",
    version: "1.0.0",
    title: "External build handoff",
    description:
      "Work built on an external delivery surface — Claude Code, Codex, Grok — returns as evidence "
      + "that a gate reads. Governance approves the evidence, never the surface that produced it, "
      + "so all three share one shape.",
    triggers: ["claim", "escalation"],
    stages: [
      {
        key: "build",
        title: "Build on the external surface",
        accountablePrincipalRef: "agent:external-claude-code",
        advance: {
          kind: "status-change",
          condition: "The change is implemented on a claimed workroom with a pushed branch.",
        },
        evidence: ["source-verified"],
      },
      {
        key: "codex-build",
        title: "Build on the Codex surface",
        accountablePrincipalRef: "agent:external-codex",
        advance: {
          kind: "status-change",
          condition: "Same contract as any other surface: claimed workroom, pushed branch, recorded evidence.",
        },
        evidence: ["source-verified"],
      },
      {
        key: "grok-build",
        title: "Build on the Grok surface",
        accountablePrincipalRef: "agent:external-grok",
        advance: {
          kind: "status-change",
          condition: "Same contract as any other surface: claimed workroom, pushed branch, recorded evidence.",
        },
        evidence: ["source-verified"],
      },
      {
        key: "accept-evidence",
        title: "Accept the delivery evidence",
        accountablePrincipalRef: "role:delivery-coordinator",
        advance: {
          kind: "governed-decision",
          condition:
            "The gate reads the required evidence fields and accepts or refuses. It never asks which "
            + "surface produced them.",
          decisionScope: "external-delivery-acceptance",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Evidence is accepted and the work is admitted to the pipeline." },
      { kind: "failure", condition: "Required evidence is absent — the handoff is refused, and absence is never read as a pass." },
      { kind: "budget", condition: "More than 20 concurrent external handoffs." },
    ],
    grants: ["tool:read", "tool:workroom_evidence_write"],
    measures: [{ key: "handoffs-accepted", description: "External deliveries admitted on evidence." }],
    budgets: [{ kind: "cycles-per-window", limit: 20, unit: "handoffs" }],
    reviewPoint: { everyDays: 90, description: "Quarterly; the external CLIs ship frequently and the adapter edge moves with them." },
    collaborationShape: "change-consequential",
  },

  "catalog-scout-sweep": {
    key: "catalog-scout-sweep",
    version: "1.0.0",
    title: "External catalog scout sweep",
    description:
      "Standing scan of external catalogs for capabilities the platform might adopt. The scout "
      + "surfaces candidates with evidence; adopting one is a governed decision, because an "
      + "unvetted external dependency is a supply-chain commitment.",
    triggers: ["cadence", "estate-drift"],
    stages: [
      {
        key: "scan",
        title: "Scan for candidates",
        accountablePrincipalRef: "agent:external-catalog-scout",
        advance: {
          kind: "status-change",
          condition: "Each candidate carries its source, licence, and what gap it would close.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "adopt",
        title: "Decide adoption",
        accountablePrincipalRef: "role:platform-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "A human adopts, rejects, or defers each candidate after evaluation. No external tool is "
            + "adopted unvetted.",
          decisionScope: "external-tool-adoption",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every candidate has an adoption decision or a recorded deferral." },
      { kind: "failure", condition: "A candidate's licence or provenance cannot be established — it is dropped, not deferred." },
      { kind: "budget", condition: "More than 30 candidates in one sweep." },
    ],
    grants: ["tool:read", "tool:web_search", "tool:tool_evaluation_write"],
    measures: [{ key: "candidates-surfaced", description: "Candidates surfaced with licence and provenance." }],
    budgets: [{ kind: "findings-per-run", limit: 30, unit: "candidates" }],
    reviewPoint: { everyDays: 90, description: "Quarterly." },
    collaborationShape: "craft-stewardship",
  },
};
