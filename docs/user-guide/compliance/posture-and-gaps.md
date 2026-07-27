---
title: "Posture And Gaps"
area: compliance
order: 4
---

## Use This Doc For

- `/compliance/posture`
- `/compliance/gaps`

## Purpose

Posture is a decision aid built from current platform records. Gaps explain
which active, applicable obligations have no active control or no implemented
control. Use both views to choose work; use the underlying records as evidence.

## How Coverage Is Classified

- **Covered** — at least one linked control is active and implemented.
- **Partial** — one or more active controls are linked, but none is
  implemented.
- **Uncovered** — no active control is linked.

The gap view evaluates regulations applicable to the current install. It does
not judge whether an implemented control is legally sufficient or whether its
evidence is current.

## Review Workflow

1. Open `/compliance/posture` and note the overall score, obligation coverage,
   implemented controls, open incidents, overdue actions, published policies,
   and pending regulatory alerts.
2. Compare the current result with historical snapshots. A change may reflect
   corrected data as well as real operational improvement.
3. Open `/compliance/gaps` and start with uncovered obligations, then partial
   ones.
4. Open the obligation and confirm its source, applicability, controls,
   evidence, and owner.
5. Choose the correct response: implement an existing control, link a valid
   shared control, collect or supersede evidence, or create owned corrective
   work.
6. Take a manual snapshot after a meaningful review if you have compliance
   management permission.

## Decisions And Consequences

The score weights obligation coverage and control implementation most heavily,
then open incidents and overdue corrective actions. Changing a control to
**implemented**, linking it to an obligation, closing an incident, or removing
overdue work can improve the score. Those changes must represent reality; the
score is not a target to optimize independently.

A snapshot freezes the calculated counts and score at that time. It is useful
for trend review, but it is not a signed attestation and does not freeze the
underlying evidence.

## What To Watch

- posture dashboards being treated as proof by themselves
- long-lived gaps without corrective ownership
- summary scores masking specific weak areas
- an implemented control with no effectiveness assessment or current evidence
- a score improvement caused only by narrowing or deactivating records

## Recovery

If a gap classification is surprising, inspect the obligation-control links and
the control's active and implementation states. Correct the source record, not
the snapshot. If a prior snapshot captured bad data, leave it as historical
context and document the correction before taking a new snapshot.

## Related Help

- [Regulations and obligations](regulations-and-obligations.md)
- [Controls and evidence](controls-and-evidence.md)
- [Audits and corrective actions](audits-and-corrective-actions.md)
