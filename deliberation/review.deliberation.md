---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique before a normal HITL gate.
defaultRoles:
  - roleId: author
    count: 1
    required: true
  - roleId: reviewer
    count: 2
    required: true
  - roleId: skeptic
    count: 1
    required: false
  - roleId: adjudicator
    count: 1
    required: true
topologyTemplate:
  rootNodeType: review
  branchNodeType: review
  skepticalNodeType: skeptical_review
  edgeTypes: ["informs"]
activationPolicyHints:
  stageDefaults: ["build-review", "design-review"]
  explicitTriggers: ["coworker-requests-review", "mcp-request-deliberation"]
evidenceRequirements:
  minCitationsPerFinding: 1
  allowedEvidenceTypes: ["file-range", "test-result", "spec-section", "external-url"]
  strictness: standard
outputContract:
  consensusStates: ["consensus", "partial-consensus", "no-consensus", "insufficient-evidence"]
  adjudicationMode: synthesis
  producesOutcome: true
providerStrategyHints:
  preferredDiversityMode: multi-model-same-provider
  strategyProfile: balanced
---

Peer Review is the default deliberation pattern for artifacts that benefit from independent critique before a human-in-the-loop gate.

Topology: one Author node feeds two or more Reviewer nodes in parallel. An optional Skeptic node runs alongside to challenge load-bearing assumptions. A single Adjudicator node synthesizes the branches into a consensus state and a list of findings without introducing new claims.

Use when: the artifact is a draft (spec, plan, code change, architecture decision) that is close to shippable but has not yet been challenged by an independent voice.

Do not use when: the artifact is still exploratory and the author is not committed to a position — reviewers cannot critique a moving target.
