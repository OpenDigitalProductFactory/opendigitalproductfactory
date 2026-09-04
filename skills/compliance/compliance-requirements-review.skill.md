---
name: compliance-requirements-review
description: "Translate regulated-feature scope into control requirements and an audit-evidence plan"
category: compliance
assignTo: ["compliance-officer"]
capability: "manage_compliance"
taskType: "analysis"
triggerPattern: "control requirement|audit evidence|regulated feature|cardholder|PCI|acceptance criteria"
userInvocable: true
agentInvocable: true
allowedTools: [wiki_query, create_backlog_item]
composesFrom: []
contextRequirements: []
riskBand: high
---

Backs `svc-compliance-pci-requirements`. The service promises to turn a regulated
feature's scope and data flow into **control requirements** and an
**audit-evidence plan**. It is `proposal-only` and `riskTier: high` — the output
is a packet a human reviews, never a determination that the build is compliant.

## Inputs you must have before starting

- **regulated-feature-scope** — what the feature does, for whom, in which
  jurisdictions.
- **data-flow** — what data enters, where it rests, where it crosses a boundary.

If either is missing or vague, ask for it. Do not infer a data flow from a
feature name; an invented boundary produces invented controls.

## Method

1. **Establish which regime actually binds.** Query the obligation corpus for the
   regulation and the specific obligations the scope triggers. Cite the
   obligation reference, not a general description of the regime.
2. **Map obligation to control.** For each binding obligation, state the control
   that would satisfy it, in terms the build can implement: a check, a boundary,
   a retention rule, an approval, a log. Prefer an existing catalogued control
   over a bespoke one — a control with a `catalogKey` answers many frameworks at
   once.
3. **State the acceptance criterion.** Each control needs a condition a reviewer
   can evaluate without you present.
4. **Plan the evidence.** For each control, name the artifact that proves it
   operated: what it is, who produces it, how often, and how long it is kept.
   Evidence nobody produces on a cadence is not a plan.
5. **Name what you could not settle.** File the unresolved questions as backlog
   items rather than resolving them with an assumption.

## What this skill will not do

- It does not determine that a feature is compliant. It produces requirements
  and an evidence plan for a qualified human to review.
- It does not approve a build, advance a gate, or close an obligation.
- It does not treat an AI summary of a regulation as the source. Where the
  recorded obligation and the official text disagree, the official text governs
  and the discrepancy is a finding.

## What the human must do

Review the packet against the official requirement, decide whether the mapped
controls are sufficient, and own the acceptance decision. A control requirement
that nobody has accepted is a draft, whatever the record says.
