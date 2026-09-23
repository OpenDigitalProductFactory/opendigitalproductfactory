// The evidence kinds a work-shape stage may declare it leaves behind (§8.11).
//
// A closed set, and the SAME set `record_workroom_evidence` accepts: a stage
// advances only on recorded evidence of a kind it declared, so a declared kind
// the tool rejects is a stage that can never advance. That is not hypothetical —
// until DI-BE0348CE9229 the shapes declared these kinds while the tool accepted
// only test|build|screenshot|verification|lint|note, and no stage on the
// install ever earned a completing receipt.
//
// `WorkShapeStage.evidence` is typed against this list, so a shape cannot
// declare a kind the tool does not accept; stage-evidence-kind-parity.test.ts
// fails when a kind here is no longer declared by any shape.
//
// Leaf module — no imports — so work-capsules.ts can compose it without a cycle.

export const WORK_SHAPE_EVIDENCE_KINDS = [
  "acceptance-receipt",
  "architecture-review-receipt",
  "assurance-finding",
  "assurance-run",
  "backlog-items",
  "child-completion",
  "cited-brief",
  "cited-finding-list",
  "conversation-turn",
  "decision-record",
  "decomposition-receipt",
  "deployment-record",
  "design-doc",
  "draft-artifact",
  "drift-report",
  "epic-hypothesis",
  "exception-list",
  "failing-test",
  "import-run",
  "item-body-design",
  "manual-check",
  "merged-sha",
  "objective-baseline",
  "org-business-answer",
  "outcome-packet",
  "outcome-reconciliation",
  "passing-test",
  "pir-receipt",
  "plan-coverage-receipt",
  "plan-doc",
  "plan-review-receipt",
  "policy-divergence-list",
  "policy-draft",
  "pr-gate",
  "reconciliation",
  "reproduction",
  "research-question",
  "research-receipt",
  "runtime-check",
  "screen-capture-set",
  "security-case-timeline",
  "security-case-verdict",
  "source-document-set",
  "source-verified",
  "spec-approval-receipt",
  "surface-inventory",
  "tool-evaluation",
  "ux-verified",
] as const;

export type WorkShapeEvidenceKind = (typeof WORK_SHAPE_EVIDENCE_KINDS)[number];
