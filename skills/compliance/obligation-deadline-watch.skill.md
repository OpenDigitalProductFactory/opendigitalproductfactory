---
name: obligation-deadline-watch
description: "Report obligations, control reviews, and licence expiries falling due"
category: compliance
assignTo: ["compliance-officer"]
capability: "view_compliance"
taskType: "recurring"
cadence: "11 6 * * *"
triggerPattern: "due|overdue|deadline|renewal|expiry|review date|falling due"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Obligation deadline watch

What is falling due, what is already overdue, and what declares a recurrence
that will never fall due at all?

## What runs, and when

This skill is `taskType: recurring` with a declared `cadence` of `11 6 * * *`
(06:11 UTC). It is the coworker half of the `obligation-assurance-watch` work
shape (`apps/web/lib/work-management/work-shapes.ts`, TAK §8.11).

The deterministic half runs first: the **obligation assurance watch** job sweeps
at 05:40 UTC daily, reading

- `Obligation.frequency` and `Obligation.reviewDate`
- `Control.reviewFrequency`, `Control.lastReviewedAt`, `Control.nextReviewDate`
- `LicenseRequirementReference.staleAfterDays`, `.renewalCadenceHint`

against a 30-day look-ahead, and raises an assurance finding for each record
inside the horizon.

At Balanced proactivity this skill's turn runs weekly (Mondays); at Assertive it
runs daily. At Quiet it does not self-drive, and the operator reads the findings
directly on the assurance surface.

## What it reports

1. **Overdue**, oldest first, with the recorded accountable owner.
2. **Due inside 30 days.**
3. **Recurrence with no next date** — an obligation or control that declares a
   cadence and has no date attached. This is the most important row: it reads to
   an operator as a control in force and behaves as one that is not, and without
   a next date nobody will ever be told about it again.

## What it will not do

- It does not **decide** the response. Accepting, deferring, or remediating an
  obligation is the accountable owner's call and the work shape requires a
  governed decision for it.
- It does not invent a due date. Every date it reports traces to a recorded
  column, named in the finding's evidence.
- It does not report a clean compliance position from an empty database. An
  unread estate and a clear one look identical and are not the same, so an empty
  sweep stops and says so.
