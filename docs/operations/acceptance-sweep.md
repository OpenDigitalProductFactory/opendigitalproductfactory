# Acceptance sweep (operator runbook)

## Delivered work closes on delivery (since 2026-10-27)

A merged, green item is done. No shape owes an acceptance receipt after
delivery, and nobody needs to come back and prove it (operator direction
2026-10-27, BI-C899BB40). Only a failure recorded as the item's newest
evidence keeps it open. If something is still wrong later, whoever finds it
reports it and that becomes a new item.

Medium work can still list acceptance criteria in its body (an Acceptance
heading with one criterion per bullet, or `AC-<id>:` bullets). They describe
what done means. They are not a separate sign-off.

The `acceptance-sweep-daily` scheduled task (05:00 UTC, owned by the Portfolio
Advisor, AGT-WS-PORTFOLIO) revisits a page of `awaiting-acceptance` backlog
items each day. It records who owes each item's acceptance, measures how long
items have waited, and writes one summary to the standing **Acceptance** room.
It runs without a model. Design:
`docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md`
(§9 for closure on delivery and the customer question).

## Closing items the gate already allows (off by default)

Some awaiting-acceptance items already pass their completion gate, for example
platform work merged through CI and the merge queue. The sweep can close those
for you, but only after you allow it.

- **What it closes:** only items whose completion readiness verdict is
  `allowed`. Every close goes through the same governed completion step as the
  backlog editor and the status tool, which checks the gate again. Nothing that
  needs a decision is closed.
- **How many:** at most 100 per run by default (you can set 1 to 100). The rest
  wait for the next run. An authorisation recorded before 2026-10-27 kept its
  own number, which was 25 unless you changed it. Raise it on the card if the
  pool should drain faster.
- **Who it acts as:** the Portfolio Advisor, on your behalf. Each closure
  records you as the person who allowed it, when, and your reason.

**Where:** Admin > Platform Development, the card **Let the acceptance sweep
close finished work**. It shows whether closing is on or off, who allowed it
and when, their reason, the per-run limit, and how many items the last sweep
closed (or why it closed nothing). Only people with both the
`manage_platform` and `manage_backlog` permissions see the card.

**Turn it on.** On the card, say why (at least 12 characters) and choose
**Allow closing**. To change the per-run limit, open **Change how many it
closes per run** first. It is stored as the platform setting
`acceptance-sweep.close-authorisation`.

**Turn it off.** On the same card, say why and choose **Stop closing**. The
next run closes nothing. The record keeps who allowed it and who stopped it.

The card calls the server actions `grantAcceptanceSweepCloseAuthorisation` and
`revokeAcceptanceSweepCloseAuthorisation`, which check both permissions again.

It also switches itself off if the person who allowed it is deactivated or
loses `manage_backlog`, or if the Portfolio Advisor loses the grant that
permits completing backlog items.

## Customer-reported work: one question

An item a customer reported closes on delivery like any other. The sweep then
asks the person who reported it one question, once. It recognises customer
work from how it arrived: an ecosystem issue or demand intake, a founder
demand cluster, or a product quality report.

- **GitHub issue:** the sweep posts one comment on the issue asking the
  reporter to reopen it if the change did not fix it. It posts as the
  managed-repository login (Admin > Platform Development). Without that login,
  nothing is posted and the summary says `no-credential`. The item still closes.
- **Founder demand cluster:** the reporting installations get one notice
  through the federation link.
- **Anything else:** nothing is sent (`no-channel`).

The answer comes back on its own: the issue intake re-reads the issue's state.

| What happens | Result |
| --- | --- |
| The issue is reopened after the question | One corrective item is filed. The delivered item stays done |
| The reporter closes the issue | Confirmed |
| Nothing for 14 days | Settled by silence |

Each item gets one question and one recorded outcome. After that the sweep
never selects it again. The summary's `confirmation` section counts the
questions sent and not sent, the outcomes, and the items still waiting.

## What the summary tells you

Each run's summary in the Acceptance room has a `closing` section:

| Field | Meaning |
| --- | --- |
| `enabled`, `disabledReason`, `because` | Whether closing was on, and if not, why: `not-recorded`, `revoked`, `malformed`, `out-of-scope`, `operator-not-authorised`, `agent-not-granted`, `unavailable` |
| `authorisedBy` | Who allowed closing, and when |
| `closed` | Items closed this run |
| `refused` | Items the completion step refused when it checked again, with the reason code |
| `skipped` | Items that had already left awaiting-acceptance |
| `deferredByLimit` | Closable items left for the next run because the per-run limit was reached |

The headline ends with either `N closed under operator pre-authorisation` or
`closing off (<reason>)`.

## Who verifies an item that is not closable

An item stays awaiting acceptance only when it has no delivery evidence yet,
or its newest evidence is a failure. With routing on, an item that has waited past the aged threshold gets its own
**Acceptance verification** room, bound to one coworker who checks it on the
live install and records the evidence. The sweep never picks the item's
author, an agent that runs only outside the platform (such as the external
Claude, Codex or Grok agents), or a person.

- **Small and break-fix items** are accepted by a runtime check or the
  failing-to-passing test. The coworker is the first active, in-platform
  coworker (by agent id) holding the grant for `record_execution_evidence`
  (`build_evidence`, or `backlog_write`, which includes it). The room brief
  tells it to record the check with `record_execution_evidence`.
- **Medium and larger items** go to the coworker holding the acceptance
  reviewer grant, as before.

When nobody qualifies, the summary lists the item as unroutable with the
reason: `no-eligible-reviewer` (grant the lane to a coworker other than the
author) or `no-in-platform-coworker` (only external agents hold it).

## How the portal knows work was merged

Merged platform work closes on the merge signal: the portal checks whether the
item's branch head, or its linked pull request, is on `origin/main`. On an
install it reads the Build Studio workspace clone (`/sandbox-workspace`); a
host with a source checkout can point `DPF_HOST_SOURCE_ROOT` at it instead.

- **Kept current:** the code-graph job fetches `origin/main` into that clone
  every 15 minutes, and the completion step fetches once more just before it
  checks. Only the `origin/main` ref moves. The fetch runs as the clone's
  owner, and a failed fetch changes nothing.
- **Ownership:** the portal runs as root while the clone belongs to the
  workspace user, so each check trusts exactly that clone for that one git
  command (BI-DC2758DE). Nothing is trusted globally.
- **"The merge-through-gates signal could not run":** no checked location
  could answer. This means "unknown", never "not merged". Check that the
  clone exists and has an `origin/main`. The item stays awaiting acceptance
  with its evidence until the signal can answer.
- **A merge never outranks a current failure:** if the newest evidence of any
  kind on the item (tests, build, UX, migration) is a failure recorded in the
  last 30 days, the item cannot close: not by the sweep, the status tool, the
  backlog editor or a deployment closure. The completion check names the
  failing row. Fix it and record a passing result of the same kind, which
  replaces the failure. A manual check is always recorded as a pass, so
  writing "blocked" in its text does not stop a close (BI-4A222439,
  BI-00A50610).

## Known limit

The sweep reads each item's verdict from the same readiness view as
`get_backlog_item`. That view does not yet check the merge signal for items
still awaiting acceptance, so some items the completion step would allow may
show as not closable here. After you turn closing on, compare the
awaiting-acceptance count across two runs to see the effect.
