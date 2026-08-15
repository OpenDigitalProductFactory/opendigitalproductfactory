---
title: "Controls And Evidence"
area: compliance
order: 3
---

## Use This Doc For

- `/compliance/controls`
- `/compliance/controls/[id]`
- `/compliance/evidence`
- `/compliance/evidence/[id]`

## Purpose

A control describes the preventive, detective, or corrective measure used to
address one or more obligations. Evidence is the dated proof that a control or
obligation was actually addressed. Keeping the two distinct prevents a stored
document from being mistaken for an operating control.

## Before You Start

- Open the obligation and confirm its source, applicability, owner, and
  expected evidence.
- Decide whether the control is preventive, detective, or corrective.
- Name the control owner, implementation state, review frequency, next review
  date, and effectiveness assessment.
- Confirm that the evidence can be retrieved by an authorized reviewer and does
  not expose secrets or personal data unnecessarily.

## Record Control Coverage

1. Create or open the control at `/compliance/controls`.
2. Describe the control objective and how it operates. Do not mark it
   **implemented** merely because it is planned or documented.
3. Link the control to every obligation it genuinely addresses. One control can
   support obligations across multiple frameworks.
4. Assess effectiveness separately from implementation. An implemented control
   can still be partially effective, ineffective, or not assessed.
5. Review linked risks and the next review date.

The Controls **List**, **Grid**, and **Board** views all begin with active
controls. In Grid or Board, choose **All controls** beside the view controls to
include inactive history. The scope is part of the URL, so a shared or refreshed
link keeps the intended dataset.

## Record Evidence

1. Create an evidence record with a clear title and evidence type.
2. Link it to the relevant obligation, control, or both.
3. Record who collected it, when it was collected, the file reference, and any
   retention date.
4. Open the saved record and confirm that another reviewer can follow the link
   and understand what the artifact proves.

Evidence records are immutable. If evidence is wrong or stale, use
**supersede** to create a replacement and retire the prior record. The
supersession link preserves the audit trail. A retention date is recorded
context; it is not proof that an external file has been retained or deleted.

## Decisions And Consequences

- Linking or unlinking a control changes obligation coverage and may change gap
  and posture results immediately.
- Setting **implemented** affects coverage calculations; setting effectiveness
  communicates a separate judgment.
- Evidence linked only to an obligation appears in that obligation's evidence
  list. Submission preparation also counts active evidence linked to relevant
  obligations.
- Superseding evidence is the recovery path; editing the old proof in place is
  intentionally unavailable.

## What To Watch

- evidence collected without being tied to a specific control
- controls that look complete but have stale or weak evidence
- route users confusing document storage with actual control operation
- file references that reviewers cannot access
- evidence retention dates treated as an automated disposal mechanism

## Recovery

For a mistaken relationship, unlink only the relationship and attach the
record to the correct obligation or control. For mistaken evidence, supersede
it with a corrected record and explain the replacement. For an overstated
control, change its implementation or effectiveness state and create owned
remediation rather than leaving the posture signal artificially high.

## Related Help

- [Regulations and obligations](regulations-and-obligations.md)
- [Posture and gaps](posture-and-gaps.md)
- [Audits and corrective actions](audits-and-corrective-actions.md)
