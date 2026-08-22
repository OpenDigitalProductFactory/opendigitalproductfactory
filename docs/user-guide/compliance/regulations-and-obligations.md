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

## Why an industry match is not an approval

DPF separates four signals that can look similar but carry different authority:

- a **technical purpose capability** means the platform can perform that kind of processing;
- a **regional or archetype match** means a regulation or template may be relevant;
- an **archetype processing template** is a review-only proposal;
- a **confirmed processing activity** is the organization-owned record that a named owner approved for a bounded purpose, data scope, authority, destination, lifecycle, and effective period.

Only the last signal can make a legacy compliance-pack match authoritative. If
an industry pack matches the installed archetype but no confirmed processing
activity links the relevant authority, DPF shows **Needs review**, not
**Applies**. Templates never arrive confirmed, and an expired or incomplete
activity fails closed.

An approved policy exception also requires a defined scope, approver and
approval time, rationale, compensating control, future expiry, and remediation
backlog item.

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

The Obligations **List**, **Grid**, and **Board** views all begin with active
obligations. In Grid or Board, choose **All obligations** beside the view
controls when reviewing inactive history. The scope is retained in the URL.

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

## What Runs On Its Own

### What it does

The **obligation assurance watch** reads the recorded review date and frequency
of every obligation **that applies to your business**, and raises a finding on
the assurance ledger for each one falling due.

That scoping matters more than it sounds. Compliance packs are loaded for every
business type and then filtered to yours, so your database holds obligations
from regimes that do not bind on you — bank supervision, municipal water
testing, police training. The watch only ever reports the ones that apply. An
obligation the platform cannot confirm applies to you is left alone: deciding
whether a regime binds is your call, and a due-date reminder would pre-empt it. The coworker reviews what the sweep raised and reports it to you in plain
language: what is overdue, oldest first, with the recorded owner; what
falls due in the next 30 days; and — most important — any obligation that
declares a recurrence with **no next date**.

That last case is why the watch exists. An obligation with `frequency: annual`
and no review date reads on screen as a control that is in force, and behaves as
one that is not: nothing will ever fall due, so nobody will ever be told about
it again. The watch reports it as a defect rather than as configuration.

### Not every obligation is on a schedule

The **Frequency** you record is one of three different kinds of thing, and the
watch treats them differently:

| Frequency | What it means | Needs a review date? |
|---|---|---|
| `annual`, `quarterly`, `monthly`, … | It recurs. A date can be computed. | **Yes** — without one, nothing falls due |
| `continuous` | A standing duty, in force every day | **No** — correctly has no next date |
| `event-driven` | Started by an occurrence, not the calendar | **No** — the trigger is the event |

Only the first kind is reported when it has no date. A continuous duty is
operating, not overdue, and the watch says nothing about it.

If you record a frequency in words the platform cannot turn into a date (say
"whenever the board meets"), it tells you that too — as its own low-priority
finding. It will **not** guess a period. A due date invented by the platform and
put in front of you is worse than a missing one.

### When it runs

The sweep runs **daily at 05:40 UTC** and looks 30 days ahead. It is listed on
`/admin/scheduled-jobs` as **Obligation assurance watch**, where you can change
its cadence or run it now.

The compliance specialist's own report runs on its Proactivity setting: **weekly**
on Mondays at Balanced, **daily** at Assertive, and not at all at Quiet — at Quiet
the findings are still raised, you just read them yourself.

### How it stays current

Nothing is cached. Each run re-reads the obligation records as they stand, so
correcting a review date is reflected the next morning. A finding is keyed to the
record *and its due date*: re-running the sweep updates the same finding rather
than creating a duplicate, and once a date has been dealt with and moved beyond
the horizon its finding closes on the next run.

If the sweep cannot read the compliance records at all, it stops and says so. It
does **not** report a clean compliance position from an empty database — an
unread estate and a clear one look identical on screen and are not the same
thing.

### What it will not do

- The automation **will not decide** the response to anything it finds.
  Accepting a lapse, deferring a review, or remediating it is your decision, and
  the platform requires an explicit governed decision to record it.
- It does not read your regulator. It only reads what is recorded here, so an
  obligation nobody entered is an obligation nobody is watching.
- It does not decide that a regime applies to you. Where applicability cannot be
  confirmed from what you have recorded, the obligation shows as needing review
  and the watch stays silent on its dates rather than assuming. **This is the
  biggest limit on the page.** Obligations arrive from a compliance pack matched
  to your business type, and today packs exist for 3 of the 25 business
  categories the platform supports. If yours is not one of them, this screen
  starts empty — and an empty screen looks exactly like a clean one. See
  `docs/maintenance/obligation-cadence-coverage.md` for which categories are
  covered.
- It never estimates a due date. Every date it reports traces to a recorded
  column, named in the finding's evidence.

### What you must do

- Give every recurring obligation a **review date**, not just a frequency. The
  frequency alone schedules nothing.
- **Enter the obligations nobody shipped you.** If no pack covers your business
  type, the recurring duties you already know about — your licence renewal, your
  insurance, your annual filing — have to be recorded here before anything can
  watch them.
- Name an accountable owner. A finding with no owner still gets raised, but it
  arrives addressed to nobody.
- Decide the response when a finding lands. That step requires human approval
  and will not clear itself.

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
