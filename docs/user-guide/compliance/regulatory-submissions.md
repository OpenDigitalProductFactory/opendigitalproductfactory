---
title: "Regulatory Submissions"
area: compliance
order: 8
---

## Use This Doc For

- `/compliance/submissions`
- `/compliance/submissions/[id]`

## Purpose

A regulatory submission record coordinates preparation and records what
happened with an external filing. The platform does not transmit the filing:
**Mark Submitted** records state, submission time, and submitter after the
authorized external submission has occurred.

## Before You Start

- Confirm the regulation, recipient body, submission type, and official due
  date.
- Confirm who is authorized to approve and transmit the filing.
- Assemble the source data outside the status transition, and verify it against
  the authoritative system.
- Review the preparation checklist. It counts active evidence linked directly
  to the regulation's active obligations; it does not judge evidence quality or
  block a transition.

## Submission Lifecycle

1. **draft → pending** when the package is assembled for final review.
2. **pending → draft** when review finds changes are needed.
3. **pending → submitted** only after external transmission. This records the
   time and current employee as submitter.
4. **submitted → acknowledged** when the recipient confirms acceptance or
   receipt.
5. **submitted → rejected** when the recipient rejects or returns it.
6. **rejected → draft** to correct and prepare a new attempt.

Acknowledged is terminal in the current workflow. A submitted record cannot be
returned directly to draft. Record confirmation references, response dates,
and response summaries so another reviewer can reconstruct the outcome.

## Final Review

- Every required obligation has current, accessible evidence.
- Numbers, dates, scope, and signatories match the authoritative source data.
- The recipient and submission channel are correct.
- Sensitive material is handled through an approved channel.
- An authorized person has approved the package.
- The external receipt or confirmation can be retained.

## Decisions And Consequences

Changing status is an auditable record change, not an external action. The due
date can create a calendar event when an employee context is available, but it
does not guarantee delivery or escalation. Missing evidence in the checklist
is a readiness warning; the interface still relies on operator judgment.

## What To Watch

- submissions prepared without confirmed source data
- due dates tracked outside the submission record
- post-submission follow-up not being captured
- **Mark Submitted** used before the external filing actually occurs
- an acknowledgement recorded without a confirmation reference or retained
  receipt

## Recovery

If review finds a problem while pending, return to draft. If the recipient
rejects a submitted filing, record the rejection and response, then return it
to draft for correction. If the wrong record was marked submitted, do not
invent an acknowledgement; preserve the audit trail, document the error, and
escalate to the compliance owner for the corrective record.

## Related Help

- [Regulations and obligations](regulations-and-obligations.md)
- [Controls and evidence](controls-and-evidence.md)
- [Audits and corrective actions](audits-and-corrective-actions.md)
