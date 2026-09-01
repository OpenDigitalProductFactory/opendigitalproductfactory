// Standing business-operations shapes (BI-7E7B93DF).
//
// Split out of work-shapes.ts, which owns the CONTRACT (types, validation, the
// cycle projection) and the anchor compliance shape. This module holds only
// declarations, so the contract module stays under the size ratchet and a new
// standing shape never has to touch the rules that govern it.
//
// The import back to work-shapes.ts is TYPE-ONLY and therefore erased at
// compile time: work-shapes.ts imports these values, this file imports only its
// types, and no runtime cycle exists.

import type { WorkShapeDefinition } from "./work-shapes";

// ── standing business-operations shapes (BI-7E7B93DF) ────────────────────────
//
// The anchor shape above proved the contract on one compliance activity. These
// declare the standing operations a business actually runs, so a Workroom has
// a drive to bind to. Each is portfolio-aligned per DPF-PAAW §6 and every one
// obeys the same rule the anchor set: the agent gathers and reports, and the
// consequential act — merging, sending, paying, rotating a credential, granting
// authority — is a `role:` stage the runner refuses to execute.
//
// Agent references are canonical `agent_name` slugs from
// packages/db/data/agent_registry.json. An invented coworker is a fabrication,
// so a conformance test asserts every referenced agent exists in that registry.

export const DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY = "dependency-advisory-watch";
export const REPOSITORY_POLICY_DRIFT_WATCH_SHAPE_KEY = "repository-policy-drift-watch";
export const CREDENTIAL_HYGIENE_WATCH_SHAPE_KEY = "credential-hygiene-watch";
export const PULL_REQUEST_FLOW_WATCH_SHAPE_KEY = "pull-request-flow-watch";
export const ISSUE_TRIAGE_WATCH_SHAPE_KEY = "issue-triage-watch";
export const RELEASE_READINESS_WATCH_SHAPE_KEY = "release-readiness-watch";
export const INQUIRY_RESPONSE_WATCH_SHAPE_KEY = "inquiry-response-watch";
export const ADOPTER_HEALTH_WATCH_SHAPE_KEY = "adopter-health-watch";
export const PAYABLES_WATCH_SHAPE_KEY = "payables-watch";
export const VENDOR_RENEWAL_WATCH_SHAPE_KEY = "vendor-renewal-watch";
export const CONTRIBUTOR_INTAKE_WATCH_SHAPE_KEY = "contributor-intake-watch";
export const COWORKER_FITNESS_WATCH_SHAPE_KEY = "coworker-fitness-watch";

/** Every standing shape declared below, in portfolio order. */
export const STANDING_OPERATIONS_SHAPE_KEYS = [
  DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY,
  REPOSITORY_POLICY_DRIFT_WATCH_SHAPE_KEY,
  CREDENTIAL_HYGIENE_WATCH_SHAPE_KEY,
  PULL_REQUEST_FLOW_WATCH_SHAPE_KEY,
  ISSUE_TRIAGE_WATCH_SHAPE_KEY,
  RELEASE_READINESS_WATCH_SHAPE_KEY,
  INQUIRY_RESPONSE_WATCH_SHAPE_KEY,
  ADOPTER_HEALTH_WATCH_SHAPE_KEY,
  PAYABLES_WATCH_SHAPE_KEY,
  VENDOR_RENEWAL_WATCH_SHAPE_KEY,
  CONTRIBUTOR_INTAKE_WATCH_SHAPE_KEY,
  COWORKER_FITNESS_WATCH_SHAPE_KEY,
] as const;

const MONTHLY_REVIEW = {
  everyDays: 30,
  description:
    "Reviewed monthly whether or not it moved: an activity that has reported nothing for a "
    + "month is as likely to be broken as to be reassuring.",
} as const;

/** The standing operations registry, merged into the full registry by work-shapes.ts. */
export const STANDING_SHAPES: Record<string, WorkShapeDefinition> = {
  // ── foundational · Source Custody and Assurance ────────────────────────────
  [DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY]: {
    key: DEPENDENCY_ADVISORY_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Dependency and advisory watch",
    description:
      "The security engineer sweeps published advisories against the recorded dependency "
      + "manifest, raises a finding for each one that reaches this estate, and hands the "
      + "accountable owner the accept / patch / defer decision. It never applies a patch.",
    triggers: ["cadence", "estate-drift"],
    stages: [
      {
        key: "sweep",
        title: "Sweep advisories against the manifest",
        accountablePrincipalRef: "agent:security-engineer",
        advance: {
          kind: "status-change",
          condition: "Every advisory source in scope has been read and correlated to the recorded manifest.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "raise",
        title: "Raise reachable findings",
        accountablePrincipalRef: "agent:security-engineer",
        advance: {
          kind: "status-change",
          condition: "Each advisory that reaches a recorded dependency has an open finding; each one that no longer does is reconciled.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "decide",
        title: "Decide the response to each finding",
        accountablePrincipalRef: "role:security-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner accepts, patches, or defers with a date.",
          decisionScope: "security-advisory-response",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No advisory reaching a recorded dependency remains without an open finding." },
      { kind: "failure", condition: "The advisory source or the dependency manifest cannot be read — the run stops and reports, and does NOT raise findings from an empty read." },
      { kind: "budget", condition: "More than 100 findings would be raised in one run — the run stops and escalates rather than burying the ledger." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "advisories-reviewed", description: "Advisories correlated against the manifest in one run." },
      { key: "findings-raised", description: "Findings opened for advisories reaching this estate." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "findings" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  [REPOSITORY_POLICY_DRIFT_WATCH_SHAPE_KEY]: {
    key: REPOSITORY_POLICY_DRIFT_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Repository policy drift watch",
    description:
      "The platform engineer reads the repository's enforced policy — branch protection, "
      + "sign-off requirement, token grants — and diffs it against the declared policy. A "
      + "drift is reported for a human to approve or correct; the watch never changes policy.",
    triggers: ["cadence", "authority-change"],
    stages: [
      {
        key: "read",
        title: "Read the enforced policy",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Branch protection, sign-off enforcement, and token grants have been read for every repository in scope.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "diff",
        title: "Diff enforced against declared policy",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Every difference between enforced and declared policy is recorded as a drift finding.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "approve",
        title: "Approve the policy change or correct the drift",
        accountablePrincipalRef: "role:platform-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner ratifies the enforced policy or directs its correction.",
          decisionScope: "repository-policy-change",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Enforced policy matches declared policy for every repository in scope." },
      { kind: "failure", condition: "The forge is unreachable or the declared policy is absent — the run stops and reports, and does NOT infer a drift from a failed read." },
      { kind: "budget", condition: "More than 50 drift findings in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "repositories-read", description: "Repositories whose enforced policy was read." },
      { key: "drifts-found", description: "Differences between enforced and declared policy." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "findings" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  [CREDENTIAL_HYGIENE_WATCH_SHAPE_KEY]: {
    key: CREDENTIAL_HYGIENE_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Credential hygiene watch",
    description:
      "The security engineer reports credential age and any exposure signal. Rotation is a "
      + "human stage by construction — a watch that could rotate a credential could also lock "
      + "the business out of its own systems unattended.",
    triggers: ["cadence", "evidence-decay"],
    stages: [
      {
        key: "scan",
        title: "Report credential age and exposure signals",
        accountablePrincipalRef: "agent:security-engineer",
        advance: {
          kind: "status-change",
          condition: "Every recorded credential has a reported age and exposure status.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "rotate",
        title: "Rotate the credential",
        // Never an agent. Rotation is one of the three acts the design fixes as human.
        accountablePrincipalRef: "role:security-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner rotates the credential or records why it stands.",
          decisionScope: "credential-rotation",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No recorded credential is past its age threshold or carries an exposure signal." },
      { kind: "failure", condition: "The credential inventory cannot be read — the run stops and reports, and never reports an unread credential as healthy." },
      { kind: "budget", condition: "More than 50 credentials would be reported in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "credentials-reported", description: "Credentials whose age and exposure status were reported." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "credentials" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  // ── manufactureAndDeliver · Contribution Flow ──────────────────────────────
  [PULL_REQUEST_FLOW_WATCH_SHAPE_KEY]: {
    key: PULL_REQUEST_FLOW_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Pull-request flow watch",
    description:
      "The change reviewer reads mechanical pull-request health, classifies each open change "
      + "as stalled, conflicted, or awaiting review, and summarizes what needs a person. The "
      + "merge decision stays human.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "read",
        title: "Read mechanical pull-request health",
        accountablePrincipalRef: "agent:change-reviewer",
        advance: {
          kind: "status-change",
          condition: "Every open pull request in scope has a mechanically-read health state — never a visual scan of some checks.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "classify",
        title: "Classify and summarize what needs a person",
        accountablePrincipalRef: "agent:change-reviewer",
        advance: {
          kind: "status-change",
          condition: "Each open change is classified stalled, conflicted, awaiting-review, or ready, with the blocking reason named.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "merge",
        title: "Decide the merge",
        accountablePrincipalRef: "role:change-approver",
        advance: {
          kind: "governed-decision",
          condition: "The accountable approver merges, requests changes, or closes.",
          decisionScope: "change-merge-decision",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open pull request carries a current classification and a named blocking reason." },
      { kind: "failure", condition: "The forge is unreachable or returns no pull requests where the repository is known to have them — the run stops and reports rather than declaring the queue clear." },
      { kind: "budget", condition: "More than 100 pull requests in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "changes-classified", description: "Open pull requests classified in one run." },
      { key: "stalled-changes", description: "Changes found stalled past their threshold." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "pull requests" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "change-consequential",
  },

  [ISSUE_TRIAGE_WATCH_SHAPE_KEY]: {
    key: ISSUE_TRIAGE_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Issue triage watch",
    description:
      "The portfolio advisor classifies inbound issues, checks each against the existing "
      + "backlog for duplication, and proposes a backlog item. Admission to the backlog is a "
      + "human decision — an agent that could admit its own proposals would grow the backlog "
      + "without anyone choosing to.",
    triggers: ["cadence"],
    stages: [
      {
        key: "classify",
        title: "Classify inbound issues",
        accountablePrincipalRef: "agent:portfolio-advisor",
        advance: {
          kind: "status-change",
          condition: "Every untriaged issue in scope is classified by kind and severity.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "dedupe",
        title: "Check against the existing backlog and propose",
        accountablePrincipalRef: "agent:portfolio-advisor",
        advance: {
          kind: "status-change",
          condition: "Each issue is matched to an existing backlog item or carries a proposed new one.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "admit",
        title: "Admit the item into the backlog",
        accountablePrincipalRef: "role:backlog-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner admits, merges into an existing item, or declines.",
          decisionScope: "backlog-admission",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No untriaged issue remains without a classification and a duplicate check." },
      { kind: "failure", condition: "The issue source or the backlog cannot be read — the run stops and reports, and never proposes items from an unread backlog." },
      { kind: "budget", condition: "More than 50 proposals in one run — the run stops and escalates rather than flooding triage." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "issues-classified", description: "Issues classified in one run." },
      { key: "duplicates-found", description: "Issues matched to an existing backlog item." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "proposals" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "specialist-alignment",
  },

  [RELEASE_READINESS_WATCH_SHAPE_KEY]: {
    key: RELEASE_READINESS_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Release readiness watch",
    description:
      "The build specialist assembles the gate evidence a release requires and names exactly "
      + "what is missing. Cutting the release is a human stage — assembling evidence and "
      + "deciding it is sufficient are different acts.",
    triggers: ["cadence", "deadline-horizon"],
    stages: [
      {
        key: "assemble",
        title: "Assemble the gate evidence",
        accountablePrincipalRef: "agent:build-specialist",
        advance: {
          kind: "status-change",
          condition: "Every required gate has its evidence collected or is explicitly recorded as missing.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "report",
        title: "Name what is missing",
        accountablePrincipalRef: "agent:build-specialist",
        advance: {
          kind: "status-change",
          condition: "Each missing gate is named with what would satisfy it. An absent gate is never reported as passing.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "cut",
        title: "Cut the release",
        accountablePrincipalRef: "role:release-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner cuts the release or holds it with a named reason.",
          decisionScope: "release-cut-decision",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every required gate is either evidenced or named as missing." },
      { kind: "failure", condition: "The gate evidence store cannot be read — the run stops and reports, and never records an unread gate as satisfied." },
      { kind: "budget", condition: "More than 20 release candidates assessed in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "gates-evidenced", description: "Required gates with evidence collected." },
      { key: "gates-missing", description: "Required gates recorded as missing." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 20, unit: "release candidates" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  // ── productsAndServicesSold · Adopter and Inquiry Desk ─────────────────────
  [INQUIRY_RESPONSE_WATCH_SHAPE_KEY]: {
    key: INQUIRY_RESPONSE_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Inquiry response watch",
    description:
      "The customer advisor drafts a grounded reply to each waiting inquiry and attaches the "
      + "evidence it rests on. Sending is a human stage by construction — anything leaving the "
      + "business under its own name is never an unattended act.",
    triggers: ["escalation", "cadence"],
    stages: [
      {
        key: "draft",
        title: "Draft a grounded reply",
        accountablePrincipalRef: "agent:customer-advisor",
        advance: {
          kind: "status-change",
          condition: "Every waiting inquiry has a draft reply whose every claim cites recorded evidence.",
        },
        evidence: ["draft-artifact"],
      },
      {
        key: "send",
        title: "Send the reply",
        // Outbound. Never an agent, at any posture.
        accountablePrincipalRef: "role:customer-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner sends the reply, edits it first, or declines to answer.",
          decisionScope: "outbound-customer-communication",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No waiting inquiry is without a draft reply." },
      { kind: "failure", condition: "The inquiry store cannot be read — the run stops and reports, and never drafts a reply to an inquiry it could not read." },
      { kind: "budget", condition: "More than 25 drafts in one run — the run stops and escalates rather than generating a queue nobody can review." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "inquiries-drafted", description: "Waiting inquiries given a grounded draft reply." },
      { key: "oldest-inquiry-age-days", description: "Age of the longest-waiting unanswered inquiry." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 25, unit: "drafts" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "outward-review",
  },

  [ADOPTER_HEALTH_WATCH_SHAPE_KEY]: {
    key: ADOPTER_HEALTH_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Adopter health watch",
    description:
      "The customer advisor reads recorded adopter signals and reports which relationships "
      + "need attention. It states what is unknown rather than presenting an absent signal as "
      + "a healthy one.",
    triggers: ["cadence"],
    stages: [
      {
        key: "read",
        title: "Read recorded adopter signals",
        accountablePrincipalRef: "agent:customer-advisor",
        advance: {
          kind: "status-change",
          condition: "Every recorded adopter relationship has been read, with unknowns named as unknown.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "report",
        title: "Report relationships needing attention",
        accountablePrincipalRef: "agent:customer-advisor",
        advance: {
          kind: "status-change",
          condition: "Each at-risk relationship is reported with the signal it rests on and what to record to make an unknown known.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "act",
        title: "Act on the relationship",
        accountablePrincipalRef: "role:customer-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner acts on the signal or records why no action is needed.",
          decisionScope: "adopter-relationship-action",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every recorded adopter relationship has a current health report." },
      { kind: "failure", condition: "The adopter records cannot be read — the run stops and reports, and never reports an unread relationship as healthy." },
      { kind: "budget", condition: "More than 100 relationships assessed in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "relationships-read", description: "Adopter relationships read in one run." },
      { key: "at-risk-relationships", description: "Relationships reported as needing attention." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "relationships" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "specialist-alignment",
  },

  // ── foundational · Business Administration ────────────────────────────────
  [PAYABLES_WATCH_SHAPE_KEY]: {
    key: PAYABLES_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Payables watch",
    description:
      "The finance controller reports what falls due and what is not recorded at all. Paying "
      + "is a human stage by construction — money movement is never an unattended act, and an "
      + "absent bill is reported as unknown rather than as nothing owed.",
    triggers: ["deadline-horizon", "cadence"],
    stages: [
      {
        key: "read",
        title: "Read recorded bills and recurring commitments",
        accountablePrincipalRef: "agent:finance-controller",
        advance: {
          kind: "status-change",
          condition: "Every recorded bill and recurring commitment inside the horizon has been read.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "report",
        title: "Report what falls due and what is unrecorded",
        accountablePrincipalRef: "agent:finance-controller",
        advance: {
          kind: "status-change",
          condition: "Each obligation inside the horizon is reported, and gaps are named as unknown with what to record — never as zero.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "pay",
        title: "Pay the bill",
        // Money movement. Never an agent, at any posture.
        accountablePrincipalRef: "role:finance-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner pays, schedules, disputes, or defers with a date.",
          decisionScope: "payables-disbursement",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every recorded obligation inside the horizon is reported with a due date and an owner." },
      { kind: "failure", condition: "The finance substrate cannot be read — the run stops and reports, and NEVER presents an absent amount as zero." },
      { kind: "budget", condition: "More than 100 obligations reported in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "obligations-reported", description: "Bills and commitments reported inside the horizon." },
      { key: "unrecorded-gaps", description: "Named gaps where an obligation is expected but not recorded." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "obligations" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  [VENDOR_RENEWAL_WATCH_SHAPE_KEY]: {
    key: VENDOR_RENEWAL_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Vendor and subscription renewal watch",
    description:
      "The finance controller reports upcoming renewals and spend against recorded "
      + "commitments. Renewing or cancelling is a human stage — both are outward commitments.",
    triggers: ["deadline-horizon", "cadence"],
    stages: [
      {
        key: "read",
        title: "Read supplier agreements and spend",
        accountablePrincipalRef: "agent:finance-controller",
        advance: {
          kind: "status-change",
          condition: "Every recorded supplier agreement and its spend to date has been read.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "report",
        title: "Report renewals and spend against commitment",
        accountablePrincipalRef: "agent:finance-controller",
        advance: {
          kind: "status-change",
          condition: "Each renewal inside the horizon is reported with spend against its commitment, and unknowns are named.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "decide",
        title: "Renew or cancel",
        accountablePrincipalRef: "role:finance-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner renews, renegotiates, or cancels.",
          decisionScope: "vendor-renewal-decision",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every renewal inside the horizon is reported with its spend position." },
      { kind: "failure", condition: "Supplier records cannot be read — the run stops and reports, and never infers a renewal from an unread agreement." },
      { kind: "budget", condition: "More than 50 agreements assessed in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "agreements-read", description: "Supplier agreements read in one run." },
      { key: "renewals-in-horizon", description: "Renewals falling inside the look-ahead window." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "agreements" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  // ── forEmployees · Contributor Relations ──────────────────────────────────
  [CONTRIBUTOR_INTAKE_WATCH_SHAPE_KEY]: {
    key: CONTRIBUTOR_INTAKE_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Contributor intake watch",
    description:
      "The platform engineer keeps the contributor inventory current and flags missing "
      + "sign-off or licence facts. Admitting a contributor is a human stage — it grants "
      + "standing in the project.",
    triggers: ["cadence"],
    stages: [
      {
        key: "sync",
        title: "Sync the contributor inventory",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "The recorded contributor inventory matches the observed contribution history.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "flag",
        title: "Flag missing sign-off or licence facts",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Every contributor missing a required sign-off or licence fact is flagged with what is missing.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "admit",
        title: "Admit the contributor",
        accountablePrincipalRef: "role:contributor-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner admits the contributor or records what is still required.",
          decisionScope: "contributor-admission",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every observed contributor is recorded with their sign-off and licence status." },
      { kind: "failure", condition: "The contribution history cannot be read — the run stops and reports, and never records a contributor it could not observe." },
      { kind: "budget", condition: "More than 200 contributors reconciled in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "contributors-reconciled", description: "Contributors reconciled against observed history." },
      { key: "missing-signoff", description: "Contributors flagged for a missing sign-off or licence fact." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 200, unit: "contributors" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  [COWORKER_FITNESS_WATCH_SHAPE_KEY]: {
    key: COWORKER_FITNESS_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Coworker fitness watch",
    description:
      "The platform engineer reports which AI coworkers have unresolved capability gaps or "
      + "stale qualifications. Granting or revoking authority is a human stage — a watch that "
      + "could widen a grant could widen its own.",
    triggers: ["cadence", "evidence-decay"],
    stages: [
      {
        key: "measure",
        title: "Measure coworker capability and qualification freshness",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Every registered coworker has a measured capability and qualification state.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "report",
        title: "Report gaps and stale qualifications",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Each unresolved gap or stale qualification is reported with what would close it.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "grant",
        title: "Grant or revoke",
        // Authority change. Never an agent.
        accountablePrincipalRef: "role:workforce-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner grants, revokes, or accepts the gap with a reason.",
          decisionScope: "coworker-authority-change",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every registered coworker has a current capability and qualification report." },
      { kind: "failure", condition: "The coworker registry cannot be read — the run stops and reports, and never reports an unread coworker as fit." },
      { kind: "budget", condition: "More than 100 coworkers assessed in one run — the run stops and escalates." },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "coworkers-measured", description: "Coworkers whose capability state was measured." },
      { key: "open-gaps", description: "Unresolved capability gaps reported." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "coworkers" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },
};

