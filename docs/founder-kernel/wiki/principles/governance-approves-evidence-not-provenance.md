---
title: Governance approves evidence, not provenance
slug: governance-approves-evidence-not-provenance
pageKind: principle
status: published
abstract: A draft advances through a phase gate when the evidence the gate requires is present and passes review — regardless of who or what produced the evidence. Gate logic depends on evidence fields, never on producer identity.
principleTier: core
principleDirection: Evaluate phase-gate decisions on the quality of evidence presented; never gate on producer identity (which agent dispatched, whether a human or coworker authored, whether the work came through Build Studio or an external branch).
principleDimensionVector: {"governance_compliance": 1.0, "evidence_density": 0.9, "reusability": 0.7, "long_term_maintainability": 0.6, "human_cognitive_load": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - build-studio
  - engineering-flow
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
principleOverlapScan:
  highestAlignment: 0.74
  highestAlignmentSlug: never-fabricate
  scanRunAt: 2026-05-26
  rationale: |
    Crosses the §4.3 ship-freely threshold of 0.70; falls below the 0.85 reject line.
    Body includes an additivity paragraph (see "Additivity to Never Fabricate" below)
    explaining why this principle is additive rather than redundant. Mechanical scan via
    principle_decide ran with ringScope=[ring-2-workflow, ring-4-sandbox-prod] and returned
    10 commandment-tier principles. Highest dimension-vector alignment was 0.74 against
    Never Fabricate; Build Gate Mandatory at 0.70, All Changes Land via PR at 0.69, DCO
    Sign-Off at 0.65 followed. These are dimension-vector alignments (do the candidate's
    features point the same way as the existing principle's vector?), not semantic-redundancy
    scores — the alignment is driven by shared dimensions (governance_compliance high,
    evidence_density high) rather than overlapping decision moments.
---

# Governance approves evidence, not provenance

**A Build Studio draft advances through a phase when the evidence required by the gate is present and passes review** — regardless of whether Build Studio dispatched the specialists that produced the evidence, whether the operator hand-coded the change, whether the work came through an external branch, or whether a different coworker produced the artifact. Governance evaluates evidence quality, not producer identity.

Operator-ratified 2026-05-18 in the PR #761 discussion, when evaluating how to handle a draft stuck in `ideate` after the implementation PR had already landed independently. The principle-based answer: *use the gates with the available evidence; never mark complete to bypass the gates.*

## Evidence must serve a decision

Evidence exists to resolve a named uncertainty, verify a meaningful claim, or protect a concrete constraint. Required fields, receipt counts, and reviewer counts do not justify themselves. Before adding or retaining a blocking step, identify the decision or protection it serves, what information could change the outcome, and why existing evidence does not suffice. This is a design test, not another required form.

Remove, consolidate, or automate steps that add no decision value or necessary protection. Reuse valid evidence by reference; do not make contributors rewrite identical facts into successive formats or obtain duplicate reviews merely to advance status. Reopen only the evidence affected by a changed artifact, assumption, risk, or authority. Scale verification to consequence, reversibility, uncertainty, and changed behavior; additional collection stops when it would not change the decision or satisfy a still-unmet protection.

An infrastructure failure is not an adverse judgment of the artifact. Report it as unverified or inconclusive and use the supported recovery path. Never fabricate a receipt, a test pass, or an independent finding to make status advance. Independence and actual permission constraints remain valid; the producing client or brand does not determine evidence quality.

Judge the process by outcomes, defects prevented, elapsed time, rework, and human attention consumed. Repeated approvals and stalled work are reasons to examine the process itself. Founder correction: 2026-09-05, BI-DC0F14E0.

## The rule

When a phase gate is invoked:

1. **Read the relevant evidence for the gate's named decision or protection** (`designDoc`, `buildPlan`, `verificationOut`, `acceptanceMet`, `phaseHandoff`, etc.).
2. **Run the gate's evaluation against that evidence** — does it pass on quality, completeness, and the gate's specific predicates?
3. **Advance if the evaluation passes; block if it fails.** The decision is identical regardless of who or what produced the evidence.

Producer identity is a useful audit field, not a gate input.

## Two ways this gets violated

**Path A — bypassing the gate.** "The PR already landed; just mark the draft complete." This skips review entirely. The draft moves to `complete` without the gate's evidence checks ever firing. Future audits cannot reconstruct whether the work actually met the gate's quality bar — only that someone clicked a button.

**Path B — gating on producer.** Gate logic that contains `if (producerAgent === "AGT-ORCH-300") { allow }` or `if (sourceBranch.startsWith("claude/")) { require extra review }`. This makes the gate brittle (new producers need code changes), discriminatory (identical evidence quality, different gate decision), and unable to handle the legitimate case of an external producer with strong evidence.

Both paths reach the same failure mode: governance signal degrades because the gate stops being a function of evidence.

## How to apply

- **When a draft is stuck behind a gate but external evidence satisfies the gate's requirements**, seed the evidence fields (`saveBuildEvidence` for each missing field, or `save_phase_handoff` for cross-phase transitions) and advance through the existing gate. Each transition still runs `checkPhaseGate` — nothing is rubber-stamped.
- **When designing a new lifecycle gate**, the gate's input shape must be the evidence the gate needs, not the identity of the actor or the path that produced it. No "did Build Studio dispatch this" checks. No "is the author the spec owner" checks. Only evidence-quality checks.
- **When reviewing a PR that adds a gate**, look for producer-conditional logic and reject it. The reviewer's question is "does this gate pass identical evidence identically?" — if not, it is a provenance gate masquerading as an evidence gate.

## When this principle conflicts with others

It can appear to conflict with [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md) (some destructive actions *do* require fresh operator approval per call) and with HITL gates that require human acknowledgement. The resolution: those principles add **additional** requirements on top of evidence quality (a fresh approval is itself evidence the gate requires), they do not subtract the evidence requirement. A destructive action with operator approval but no evidence still does not advance; an action with strong evidence but no fresh approval still does not advance. Both fire when both apply.

## Anti-pattern

- **"Mark complete and skip the gates" as a shortcut.** This is the standing operator-forbidden move, no matter how strong the external evidence appears. The principle is to *use* the gates with the available evidence, not bypass them.
- **Gate logic that branches on `producer` / `dispatcher` / `sourceAgent` fields.** Audit log, yes. Gate input, no.
- **Asymmetric trust by author identity** ("Mark's commits skip review; coworker commits get full review"). This compounds in two directions: the platform stops detecting Mark's mistakes, and the coworker can never accumulate trust. Both erode the autonomy ladder.

## Additivity to Never Fabricate

The 2026-05-26 mechanical overlap scan (`principle_decide`, ring scope `[ring-2-workflow, ring-4-sandbox-prod]`) returned a 0.74 dimension-vector alignment against [`never-fabricate`](never-fabricate.md), crossing the §4.3 ship-freely threshold of 0.70 and triggering the additivity-paragraph requirement.

The alignment is dimension-driven, not decision-moment-driven. Both principles score high on `governance_compliance` and `evidence_density` because both protect the truth substrate the platform depends on. But they bind **different decision moments**:

- **Never Fabricate** binds the *producer* moment: "do not invent facts, results, or capabilities you did not actually observe." It governs what a coworker is allowed to *say*.
- **Governance-approves-evidence-not-provenance** binds the *gate-evaluator* moment: "when a phase gate fires, evaluate the evidence presented, not who or what produced it." It governs how a *gate* is allowed to *decide*.

A coworker that fabricates evidence violates Never Fabricate (the producer rule). A gate that branches on `producer === "AGT-ORCH-300"` violates this principle (the evaluator rule). The two failures occur at different layers, are detected by different audits, and are repaired by different changes. They compose: a healthy system needs both — non-fabricated evidence reaching a gate that evaluates that evidence on quality alone. Removing either makes the other insufficient.

Build Gate Mandatory (0.70 in the same scan) and All Changes Land via PR Against Main (0.69) sit at similar alignment for the same dimensional reason and the same additivity logic applies.

## Why one rule, not a per-case enumeration

Per [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md), the alternative is a growing list of "external branch ok if X," "operator hotfix ok if Y," "hand-coded BI ok if Z" exceptions. Each exception is a gate that the next producer scenario will not fit. One rule — *gate on evidence* — generalizes to every future "non-Build-Studio producer" scenario without code changes to the gate.

## Related principles

- [`human-in-the-loop-at-phase-boundaries`](human-in-the-loop-at-phase-boundaries.md) — defines where the gates fire; this principle defines what they evaluate.
- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — the upstream form for runtime claims; the same shape applies at gate decisions.
- [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md) — names what counts as evidence at the ship gate specifically.
- [`structured-handoffs-not-conversation-history`](structured-handoffs-not-conversation-history.md) — the artifact shape phase handoffs produce so the next gate has structured evidence to read.
- [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md) — why one principle generalizes better than a per-producer rule list.
