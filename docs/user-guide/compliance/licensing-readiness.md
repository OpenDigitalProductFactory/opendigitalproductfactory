---
title: "Licensing Readiness"
area: compliance
order: 8
---

## Use This Doc For

- `/compliance/licensing`
- Business license, permit, posting, fee, credential, and authority-layer readiness
- Tracking unresolved licensing questions before a business starts, expands, or changes regulated activity

## Workflow

1. Start with the business context, operating locations, and activities being assessed.
2. Review current licensing records and open readiness issues.
3. Capture known authority layers, evidence, expiry dates, responsible owners, and unresolved questions.
4. Create readiness issues for factual gaps instead of recording unsupported legal conclusions.
5. Revisit the page when the business adds a location, offering, staff credential, or jurisdiction.

## Evidence To Capture

- the business activity and location the requirement applies to
- authority level and issuing body
- license, permit, posting, fee, or credential type
- official source URL and the date it was checked
- accountable owner, application or renewal state, and expiry date
- receipt, certificate, identifier, or other retrievable evidence
- unresolved factual or legal questions with a named follow-up owner

Do not mark readiness from search results or an AI summary alone. Open the
official source and distinguish a confirmed requirement from a likely lead.

## Authoritative State

The licensing readiness workspace is authoritative for the platform's tracked posture and evidence. Official government or regulator sources remain authoritative for legal requirements, and counsel or qualified compliance owners make final determinations.

## AI Coworker Support

**What it does.** The licensing specialist investigates likely authority layers
for a location and activity, summarizes the evidence it can see, persists factual
findings against the record, and opens readiness issues for what it cannot
resolve. Separately, the daily obligation assurance watch reads licence
requirement staleness and renewal cadence and raises a finding when one falls
inside the 30-day horizon.

**When it runs.** The watch runs daily at 05:40 UTC. The specialist itself works
when you ask it, or on its Proactivity cadence when it has findings to review.

**How it stays current.** Only for dates you have recorded. Requirement
references carry a last-researched date and a confidence, and the underlying
requirement can change without the record moving — the watch will tell you a
renewal is near, not that the rule behind it was rewritten. Re-verify with the
issuing authority before relying on a recorded requirement.

**How long a requirement stays good for.** No acquired requirement may go more
than **90 days** without being confirmed against its issuing authority. A
reference may be re-checked sooner where the authority moves faster; it can
never be given longer, and a stored value asking for longer is clamped to 90.

Past that limit — or where a reference has never been confirmed at all — the
requirement is treated as unconfirmed rather than as current. Being unconfirmed
does not mean the requirement is wrong; it means nobody has checked recently
enough for the platform to stand behind it, and you should confirm with the
authority before acting on it.

Note that the requirements shipped with a new install have been researched but
not confirmed for your jurisdiction. They are starting points for your own
verification, not a finished licensing position.

**What it will not do.** It does not grant permission to operate, renew a
licence, pay a fee, or convert a likely lead into a confirmed requirement.
Resolving a readiness issue asserts that a person answered the question; it is
not a determination the coworker makes.

**What you must do.** Open the official source rather than accepting a search
result or an AI summary, decide each finding yourself, and re-open readiness
questions whenever you add a location, service, regulated activity, or
credentialed member of staff.

## Decisions And Consequences

A readiness issue is the safe place for uncertainty. Resolving it asserts that
the recorded question has been answered; it does not itself grant permission
to operate. Expiry dates and owners support follow-up but do not renew a
license automatically. Adding a new location, service, regulated activity, or
staff credential can change which authority layers apply.

## What To Watch

- readiness issues without a named location, activity, or authority layer
- expired permits that still appear complete in operating checklists
- fees or staff credentials tracked without an accountable owner
- AI-generated research that has not been tied back to an official source
- one jurisdiction's conclusion copied to a different location without review

## Recovery

If a record was based on the wrong activity, location, or authority, correct
the context and reopen readiness questions affected by the change. Preserve
the prior evidence where it explains a past decision. If operations may have
started without confirmed authority, escalate to the accountable business and
compliance owners rather than silently changing the status.

## Related Help

- [Regulations and obligations](regulations-and-obligations.md)
- [Posture and gaps](posture-and-gaps.md)
- [Regulatory submissions](regulatory-submissions.md)
