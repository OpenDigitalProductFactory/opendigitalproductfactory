---
slug: governance-triage
name: Governance Triage
status: active
purpose: The coworkers who own the affected domains recommend what the owner should do about a decision the kernel could not settle, and draft it.
defaultRoles:
  - roleId: debater
    count: 3
    required: true
  - roleId: skeptic
    count: 1
    required: true
  - roleId: adjudicator
    count: 1
    required: true
topologyTemplate:
  rootNodeType: analyze
  branchNodeType: analyze
  skepticalNodeType: skeptical_review
  edgeTypes: ["informs", "opposes"]
activationPolicyHints:
  stageDefaults: []
  riskEscalation:
    - level: medium
      addPattern: governance-triage
    - level: high
      addPattern: governance-triage
    - level: critical
      addPattern: governance-triage
  explicitTriggers: ["decision-escalated", "operator-requests-triage"]
evidenceRequirements:
  minCitationsPerFinding: 1
  allowedEvidenceTypes: ["prior-decision", "spec-section", "external-url", "runtime-state"]
  strictness: standard
outputContract:
  consensusStates: ["consensus", "partial-consensus", "no-consensus", "insufficient-evidence"]
  adjudicationMode: synthesis
  producesOutcome: true
providerStrategyHints:
  preferredDiversityMode: multi-model-same-provider
  strategyProfile: balanced
---

Governance Triage runs when a governed decision reached a human instead of being settled — escalated on risk or confidence, or deferred because nothing recorded answers it. Its output is not an opinion for the file: it is a drafted resolution the owner can accept, edit, or reject on the decision record.

Topology: each Domain Specialist node argues from ONE profession's craft corpus and the organization's own recorded stance, so the panel reasons from what this business has actually said rather than from generic priors. A Skeptic node attacks the leading recommendation. The Resolution Adjudicator synthesizes, drafts the artifact, and records who disagreed.

Staffing is decided outside the pattern (lib/decision/triage-staffing.ts) from the profession gate, the decision's domain, and the subject matter of the question. When no profession can be justified, the panel runs on kernel doctrine alone and the card says so — a specialist seat is never invented to make the verdict look better-founded than it is.

Use when: a decision is waiting on a human and the owner would otherwise start from a blank field.

Do not use when: the decision was already settled, or the question carries no scoreable options and no recorded context — there is nothing for a specialist to reason about, and the honest output is insufficient-evidence.
