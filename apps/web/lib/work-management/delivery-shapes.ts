// Delivery shapes (BI-B90F7CBB, design §3.0 / §4).
//
// The fifth Workroom shape axis: how big a unit of delivery work is and what it
// owes before it is done. Expressed as five `workShape` registry entries so it
// rides the existing claim, readback, drive and UI paths with no migration.
// `small | medium | large | xlarge` ARE `BacklogEffortSize`; `break-fix` is the
// expedite lane applied to a small fix, a shape of its own because its gates
// differ in kind (post-hoc review), not only in count.
//
// Like standing-operations-shapes.ts this module holds only declarations; the
// contract lives in work-shapes.ts and the import back is type-only.
//
// Every stage whose advance merges, deploys or changes authority is a
// `governed-decision` advance, exactly as the standing shapes declare. The
// author never holds the receipt writer: acceptance and post-implementation
// review are `role:` stages that the runner refuses to execute itself.

import type { WorkShapeDefinition, WorkShapeStage } from "./work-shapes";

export const DELIVERY_BREAK_FIX_SHAPE_KEY = "delivery-break-fix";
export const DELIVERY_SMALL_SHAPE_KEY = "delivery-small";
export const DELIVERY_MEDIUM_SHAPE_KEY = "delivery-medium";
export const DELIVERY_LARGE_SHAPE_KEY = "delivery-large";
export const DELIVERY_XLARGE_SHAPE_KEY = "delivery-xlarge";

/** The five delivery shapes, smallest appetite first. Closed. */
export const DELIVERY_SHAPE_KEYS = [
  DELIVERY_BREAK_FIX_SHAPE_KEY,
  DELIVERY_SMALL_SHAPE_KEY,
  DELIVERY_MEDIUM_SHAPE_KEY,
  DELIVERY_LARGE_SHAPE_KEY,
  DELIVERY_XLARGE_SHAPE_KEY,
] as const;
export type DeliveryShapeKey = (typeof DELIVERY_SHAPE_KEYS)[number];

export const DELIVERY_SHAPE_VERSION = "1.0.0";

/** `key@version` references a claim may declare. */
export const DELIVERY_SHAPE_REFS = DELIVERY_SHAPE_KEYS.map((key) => `${key}@${DELIVERY_SHAPE_VERSION}`);

export function isDeliveryShapeKey(value: unknown): value is DeliveryShapeKey {
  return typeof value === "string" && (DELIVERY_SHAPE_KEYS as readonly string[]).includes(value);
}

const merge = (evidence: readonly string[] = ["merged-sha"]): WorkShapeStage => ({
  key: "merge",
  title: "Merge through branch protection",
  accountablePrincipalRef: "role:author",
  advance: {
    kind: "governed-decision",
    condition: "The PR is green on required checks and merged through the queue; the merge SHA is reachable from main.",
    decisionScope: "delivery-merge",
  },
  evidence,
});

const acceptance = (condition: string, evidence: readonly string[]): WorkShapeStage => ({
  key: "accept",
  title: "Accept on the live install",
  accountablePrincipalRef: "role:acceptance-reviewer",
  advance: { kind: "governed-decision", condition, decisionScope: "delivery-acceptance" },
  evidence,
});

const reviewPoint = { everyDays: 7, description: "A delivery room open past its appetite is reviewed weekly whether or not it moved: reshape, split, or close." };

export const DELIVERY_SHAPES: Record<DeliveryShapeKey, WorkShapeDefinition> = {
  [DELIVERY_BREAK_FIX_SHAPE_KEY]: {
    key: DELIVERY_BREAK_FIX_SHAPE_KEY,
    version: DELIVERY_SHAPE_VERSION,
    title: "Break-fix",
    description:
      "Operational repair of a live defect or incident on the installed runtime. Reversion-shaped: restores "
      + "intended behaviour and adds no capability. Skips pre-authorisation and owes a post-implementation "
      + "review within 48 hours. Appetite: hours; one PR; Workroom optional.",
    triggers: ["claim"],
    stages: [
      {
        key: "reproduce",
        title: "Reproduce on a named ref",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "The symptom is reproduced on a named commit or install and recorded in the PR body." },
        evidence: ["reproduction"],
      },
      {
        key: "repair",
        title: "Repair",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "The repair is committed with the PR gate green; no new capability is introduced." },
        evidence: ["pr-gate"],
      },
      merge(),
      {
        key: "post-implementation-review",
        title: "Post-implementation review within 48 hours",
        accountablePrincipalRef: "role:post-implementation-reviewer",
        advance: {
          kind: "governed-decision",
          condition: "Someone other than the declarer confirms the symptom is gone on the live install and records the PIR receipt.",
          decisionScope: "break-fix-post-implementation-review",
        },
        evidence: ["pir-receipt"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "PIR receipt recorded within 48 hours of merge." },
      { kind: "failure", condition: "PIR missed: the item flips to input-required and the declarer's next break-fix declaration is refused." },
      { kind: "budget", condition: "A second break-fix is declared while one is open on this installation — refused; the lane is WIP 1." },
    ],
    grants: ["tool:read", "tool:write-source"],
    measures: [
      { key: "break-fix-share", description: "Share of merged work declared break-fix in a rolling week; above 20% is a finding." },
      { key: "pir-latency-hours", description: "Hours from merge to PIR receipt." },
    ],
    budgets: [{ kind: "cycles-per-window", limit: 1, unit: "open break-fix per installation" }],
    reviewPoint: { everyDays: 2, description: "Reviewed at the 48-hour PIR deadline whether or not the receipt landed." },
    collaborationShape: "escalation",
  },
  [DELIVERY_SMALL_SHAPE_KEY]: {
    key: DELIVERY_SMALL_SHAPE_KEY,
    version: DELIVERY_SHAPE_VERSION,
    title: "Small",
    description:
      "Bug, chore, doc or improvement whose scope is one clean revert. No new substrate: no table, enum value, "
      + "tool, route or agent role. Appetite: two days, one PR, one Workroom. Closes on merge with a runtime check "
      + "and owes no spec, plan or reconciliation receipt.",
    triggers: ["claim"],
    stages: [
      {
        key: "reproduce",
        title: "Reproduce: failing test or named symptom",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "A failing test or a reproduction on a named ref exists before the change." },
        evidence: ["reproduction", "failing-test"],
      },
      {
        key: "repair",
        title: "Repair with a passing proof",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "The failing test passes and the PR gate is green." },
        evidence: ["passing-test", "pr-gate"],
      },
      merge(),
      {
        key: "runtime-check",
        title: "Runtime check on the live install",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "The behaviour is observed on the live install or the failing-to-passing test stands as the check." },
        evidence: ["runtime-check"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Merged SHA reachable from main plus a runtime check." },
      { kind: "failure", condition: "The change needs new substrate or a second PR — reshape to medium rather than stretch the small lane." },
      { kind: "budget", condition: "Appetite exceeded: more than two days or more than one PR — the room stops and the item is reshaped." },
    ],
    grants: ["tool:read", "tool:write-source"],
    measures: [{ key: "lead-time-hours", description: "Hours from claim to merged SHA on main." }],
    budgets: [{ kind: "cycles-per-window", limit: 1, unit: "PR per item" }],
    reviewPoint,
    collaborationShape: null,
  },
  [DELIVERY_MEDIUM_SHAPE_KEY]: {
    key: DELIVERY_MEDIUM_SHAPE_KEY,
    version: DELIVERY_SHAPE_VERSION,
    title: "Medium",
    description:
      "A bounded feature or refactor inside one domain and one Workroom. May extend existing substrate; may not "
      + "add a new domain concept. Appetite: one week, one to three PRs. The item body is the design and the "
      + "baseline; an independent acceptance receipt closes it (kernel ruling 3).",
    triggers: ["claim"],
    stages: [
      {
        key: "design-note",
        title: "Design note in the item body",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "Problem, options considered, chosen option, ordered steps and acceptance criteria are in the item body; triage mints the baseline from them." },
        evidence: ["item-body-design", "objective-baseline"],
      },
      {
        key: "implement",
        title: "Implement",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "Each PR is green on the PR gate; architecture advisory is recorded when requested (non-blocking)." },
        evidence: ["pr-gate"],
      },
      merge(),
      acceptance("An eligible independent acceptance reviewer verifies the acceptance criteria on the live install (UX verification where UI).", ["acceptance-receipt"]),
    ],
    stopConditions: [
      { kind: "success", condition: "Acceptance criteria verified on the live install by an independent reviewer." },
      { kind: "failure", condition: "The work adds a new domain concept or crosses a domain contract — reshape to large." },
      { kind: "budget", condition: "Workroom cap or appetite exceeded: more than one week or more than three PRs — the room stops for reshaping." },
    ],
    grants: ["tool:read", "tool:write-source"],
    measures: [{ key: "lead-time-days", description: "Days from claim to acceptance receipt." }],
    budgets: [{ kind: "cycles-per-window", limit: 3, unit: "PRs per item" }],
    reviewPoint,
    collaborationShape: "outward-review",
  },
  [DELIVERY_LARGE_SHAPE_KEY]: {
    key: DELIVERY_LARGE_SHAPE_KEY,
    version: DELIVERY_SHAPE_VERSION,
    title: "Large",
    description:
      "New capability or cross-domain change: adds substrate or changes a contract other domains depend on. "
      + "Appetite: three weeks, one Workroom that may spawn child items. Owes a canonical spec with research and "
      + "benchmarking, independent spec approval, a plan with live backlog coverage, blocking architecture review, "
      + "deployment, and acceptance against the baseline.",
    triggers: ["claim"],
    stages: [
      {
        key: "spec",
        title: "Canonical spec with research and benchmarking",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "One design doc with marked objectives and acceptance criteria is committed and signed off." },
        evidence: ["design-doc", "research-receipt"],
      },
      {
        key: "spec-approval",
        title: "Independent spec approval mints the baseline",
        accountablePrincipalRef: "role:design-checklist-reviewer",
        advance: { kind: "governed-decision", condition: "An independent reviewer records a passing spec-approval receipt; architecture review passes.", decisionScope: "initiative-spec-approval" },
        evidence: ["spec-approval-receipt", "architecture-review-receipt", "objective-baseline"],
      },
      {
        key: "plan",
        title: "Plan with live backlog coverage",
        accountablePrincipalRef: "role:author",
        advance: { kind: "governed-decision", condition: "A phased plan is merged and a coverage record maps every deliverable to a filed backlog item; plan review passes.", decisionScope: "initiative-plan-coverage" },
        evidence: ["plan-doc", "plan-coverage-receipt", "plan-review-receipt"],
      },
      {
        key: "implement",
        title: "Implement",
        accountablePrincipalRef: "role:author",
        advance: { kind: "status-change", condition: "Each PR is green on the PR gate and specialist reviews are recorded where applicable." },
        evidence: ["pr-gate"],
      },
      merge(),
      {
        key: "deploy",
        title: "Deploy through self-upgrade",
        accountablePrincipalRef: "role:author",
        advance: { kind: "governed-decision", condition: "The reference install runs the merged release via /ops/self-upgrade.", decisionScope: "delivery-deploy" },
        evidence: ["deployment-record"],
      },
      acceptance("Acceptance evidence is recorded against the objective baseline by an eligible independent reviewer.", ["acceptance-receipt"]),
    ],
    stopConditions: [
      { kind: "success", condition: "Acceptance receipt from an independent reviewer against the baseline." },
      { kind: "failure", condition: "Spec approval or architecture review fails and is not resolved — the room stops and the item returns to design." },
      { kind: "budget", condition: "Workroom cap or appetite exceeded: more than three weeks — the room stops for decomposition into an xlarge epic." },
    ],
    grants: ["tool:read", "tool:write-source"],
    measures: [{ key: "lead-time-days", description: "Days from claim to acceptance receipt." }],
    budgets: [{ kind: "cycles-per-window", limit: 21, unit: "days per item" }],
    reviewPoint,
    collaborationShape: "change-consequential",
  },
  [DELIVERY_XLARGE_SHAPE_KEY]: {
    key: DELIVERY_XLARGE_SHAPE_KEY,
    version: DELIVERY_SHAPE_VERSION,
    title: "Extra-large (initiative)",
    description:
      "An initiative carried by an epic. Must decompose into two or more children, each with its own shape, before "
      + "any implementation starts; never enters implementation itself. Owes a hypothesis with an appetite, an "
      + "approved decomposition, and outcome reconciliation against the hypothesis when the children are done.",
    triggers: ["claim"],
    stages: [
      {
        key: "hypothesis",
        title: "Hypothesis, appetite and Lean case",
        accountablePrincipalRef: "role:portfolio-owner",
        advance: { kind: "status-change", condition: "The epic states the hypothesis, the appetite and the Lean case; the hypothesis is the baseline." },
        evidence: ["epic-hypothesis"],
      },
      {
        key: "decompose",
        title: "Decomposition approved",
        accountablePrincipalRef: "role:portfolio-owner",
        advance: { kind: "governed-decision", condition: "A decomposition into two or more shaped children is proposed and approved by portfolio review.", decisionScope: "initiative-decomposition" },
        evidence: ["decomposition-receipt", "plan-coverage-receipt"],
      },
      {
        key: "children",
        title: "Children delivered in their own shapes",
        accountablePrincipalRef: "role:portfolio-owner",
        advance: { kind: "status-change", condition: "Every child is done under its own delivery shape." },
        evidence: ["child-completion"],
      },
      {
        key: "reconcile",
        title: "Outcome reconciliation against the hypothesis",
        accountablePrincipalRef: "role:acceptance-reviewer",
        advance: { kind: "governed-decision", condition: "Delivered outcomes are reconciled against the hypothesis and recorded.", decisionScope: "initiative-outcome-reconciliation" },
        evidence: ["outcome-reconciliation"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "All children done and outcome reconciliation recorded." },
      { kind: "failure", condition: "Circuit breaker: the appetite is spent before the hypothesis is confirmed — the epic stops and is re-planned or retired." },
      { kind: "budget", condition: "Epic cap exceeded: more open initiatives than the portfolio allows — a new one is refused until one closes." },
    ],
    grants: ["tool:read"],
    measures: [{ key: "children-done-ratio", description: "Done children over filed children." }],
    budgets: [{ kind: "cycles-per-window", limit: 1, unit: "appetite per epic" }],
    reviewPoint: { everyDays: 14, description: "Reviewed fortnightly against the appetite whether or not children moved." },
    collaborationShape: "approval-sign-off",
  },
};
