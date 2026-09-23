---
slug: multi-pass
name: Multi-Pass Verification
status: active
purpose: Run the same request more than once and reconcile, to measure run-to-run variance rather than assume it away.
defaultRoles:
  - roleId: author
    count: 2
    required: true
  - roleId: adjudicator
    count: 1
    required: true
topologyTemplate:
  rootNodeType: review
  branchNodeType: review
  edgeTypes: ["informs"]
activationPolicyHints:
  stageDefaults: []
  explicitTriggers: ["routing-confidence-degraded", "mcp-request-deliberation"]
evidenceRequirements:
  minCitationsPerFinding: 0
  allowedEvidenceTypes: ["file-range", "test-result", "spec-section", "external-url"]
  strictness: lenient
outputContract:
  consensusStates: ["consensus", "partial-consensus", "no-consensus", "insufficient-evidence"]
  adjudicationMode: majority-vote
  producesOutcome: true
providerStrategyHints:
  preferredDiversityMode: single-model-multi-persona
  strategyProfile: economy
---

Multi-Pass Verification runs the same request N times (two by default, never more than three) and reconciles the results.

It exists for a failure mode the other patterns do not address. `review` improves a draft and `debate` stress-tests it, but both assume the draft is a fair sample of what the model can do. Quality varies run to run — on frontier models as much as on local ones — so the same prompt to the same model can produce a careful answer and then a careless one. Neither an improver nor a critic measures that.

**Agreement is the signal.** Two passes that agree are evidence the answer is stable; two that diverge are evidence it is not, and that divergence is reported rather than averaged away. This is the cheapest honest confidence measure available, and the only one that works when there is exactly one model to ask — which is precisely the degraded case this pattern was added for.

Topology: N independent Author passes over the identical request, feeding one Adjudicator that reconciles them. The passes do not see each other; a pass that could read its predecessor would anchor on it and the variance being measured would disappear.

It is deliberately the WEAKEST pattern in the strength ordering (`multi-pass` < `review` < `debate`). A second sample from the same model is a weaker instrument than an independent critic, and must never displace one: where an independent reviewer is available and warranted, run that instead.

Adjudication is `majority-vote`, which works where answers are comparable — a value, a classification, a decision, a diagnosis. For long free-form prose "majority" is ill-defined, and a caller wanting multi-pass over prose should select `synthesis` adjudication instead.

Use when: routing had low confidence in its own answer (the floor was relaxed, or only one model was available), or when a caller wants a stability check on an answer that will be acted on automatically.

Do not use when: an independent reviewer or a different provider is available and the work warrants it — take the stronger instrument. Also not for exploratory work, where variance between passes is the point rather than a defect.
