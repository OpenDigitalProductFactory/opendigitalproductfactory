---
slug: debate
name: Structured Debate
status: active
purpose: Two opposed positions defended on the record, with a skeptic probing both and an adjudicator synthesizing.
defaultRoles:
  - roleId: debater
    count: 2
    required: true
  - roleId: skeptic
    count: 1
    required: true
  - roleId: adjudicator
    count: 1
    required: true
topologyTemplate:
  rootNodeType: debate
  branchNodeType: debate
  skepticalNodeType: skeptical_review
  edgeTypes: ["informs", "opposes"]
activationPolicyHints:
  stageDefaults: ["architecture-decision", "build-plan-review"]
  riskEscalation:
    - level: high
      addPattern: debate
    - level: critical
      addPattern: debate
  explicitTriggers: ["coworker-requests-debate", "mcp-request-deliberation"]
evidenceRequirements:
  minCitationsPerFinding: 1
  allowedEvidenceTypes: ["file-range", "test-result", "spec-section", "external-url", "prior-decision"]
  strictness: strict
outputContract:
  consensusStates: ["consensus", "partial-consensus", "no-consensus", "insufficient-evidence"]
  adjudicationMode: synthesis
  producesOutcome: true
providerStrategyHints:
  preferredDiversityMode: multi-provider-heterogeneous
  strategyProfile: high-assurance
---

Structured Debate assigns two Debaters to defend opposed positions in good faith. A Skeptic probes both sides to surface load-bearing assumptions neither debater wants to examine. The Adjudicator synthesizes the record into a consensus state and decision without introducing new arguments.

Topology: two parallel Debater nodes each produce a defended position; one Skeptic node runs alongside; an Adjudicator node consumes all three.

Use when: a decision has two materially different viable answers, each with evidence, and picking one requires making the trade-offs explicit. Architecture decisions and plan-review forks are the primary cases.

Do not use when: the decision has only one defensible answer — debate on a settled question wastes provider budget and creates noise. Peer review is the right pattern instead.
