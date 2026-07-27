---
title: "Regulations And Obligations"
area: compliance
order: 2
---

## Use This Doc For

- `/compliance/onboard`
- `/compliance/regulations`
- `/compliance/regulations/[id]`
- `/compliance/obligations`
- `/compliance/obligations/[id]`

## Purpose

Use a regulation record to identify the authoritative framework and an
obligation record to state one requirement your organization must address.
Controls and evidence should trace back to these records so reviewers can see
why the work exists.

## Before You Start

- Obtain the official source URL or document and confirm its jurisdiction.
- Determine whether it applies to the current business, location, offering,
  workforce, or data processing activity.
- Identify an accountable owner and the expected review frequency.
- Separate a source-backed requirement from internal interpretation. Put
  unresolved interpretation in notes or follow-up work.

## Onboard A Regulation

1. Open `/compliance/onboard` and enter the regulation name, short name,
   jurisdiction, source type, source URL, and relevant dates.
2. Add discrete obligations. Include the official reference, a clear
   description, applicability, frequency, category, and expected deliverable.
3. Optionally add initial controls and link them to the obligations they
   address. New controls created by onboarding begin as **planned**.
4. Review the complete set before saving. Regulation, obligations, controls,
   and their links are created together.
5. Open the regulation detail and confirm the source, obligation count, owners,
   control coverage, and any **Source needed** warning.

## Decisions And Consequences

- **Deactivate** marks a regulation inactive; it does not erase the record.
  Confirm that the requirement is genuinely out of scope or no longer active
  before doing this.
- **Supersede** creates a new regulation version linked to the prior version
  and marks the prior version superseded. Use this for a materially changed
  source rather than overwriting history.
- Linking or unlinking a control changes the stated coverage relationship. It
  does not delete the control or obligation, but it can immediately change gap
  and posture signals.
- The platform records your interpretation; the official source remains
  authoritative.

## Evidence Of A Good Record

- the source URL opens the exact official material used
- obligations are small enough to have one clear owner and outcome
- applicability and review timing are explicit
- every claimed coverage relationship has a real operating control
- the expected deliverable is named when the obligation requires a filing,
  declaration, attestation, evidence pack, or acknowledgement

## What To Watch

- obligations created without a clear regulation source
- onboarding guidance drifting from the maintained obligation set
- control work starting before the obligation itself is well defined
- duplicate obligations copied from a new source version without a deliberate
  lineage or consolidation decision

## Recovery

If the source or scope is wrong, correct the record before adding more controls.
For a new source version, use the governed supersession path where available.
If a control was linked to the wrong obligation, remove only that relationship
and add the correct one; keep an explanation in the record or audit history.

## Related Help

- [Controls and evidence](controls-and-evidence.md)
- [Posture and gaps](posture-and-gaps.md)
- [Regulatory submissions](regulatory-submissions.md)
