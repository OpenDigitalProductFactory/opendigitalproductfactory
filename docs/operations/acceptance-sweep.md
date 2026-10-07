# Acceptance sweep (operator runbook)

The `acceptance-sweep-daily` scheduled task (05:00 UTC, owned by the Portfolio
Advisor, AGT-WS-PORTFOLIO) revisits a page of `awaiting-acceptance` backlog
items each day. It records who owes each item's acceptance, measures how long
items have waited, and writes one summary to the standing **Acceptance** room.
It runs without a model. Design:
`docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md`.

## Closing items the gate already allows (off by default)

Some awaiting-acceptance items already pass their completion gate, for example
platform work merged through CI and the merge queue. The sweep can close those
for you, but only after you allow it.

- **What it closes:** only items whose completion readiness verdict is
  `allowed`. Every close goes through the same governed completion step as the
  backlog editor and the status tool, which checks the gate again. Nothing that
  needs a decision is closed.
- **How many:** at most 25 per run by default (you can set 1 to 100). The rest
  wait for the next run.
- **Who it acts as:** the Portfolio Advisor, on your behalf. Each closure
  records you as the person who allowed it, when, and your reason.

**Turn it on.** An operator with both the `manage_platform` and
`manage_backlog` permissions grants it with a reason
(`grantAcceptanceSweepCloseAuthorisation`). It is stored as the platform
setting `acceptance-sweep.close-authorisation`.

**Turn it off.** The same operator permissions revoke it with a reason
(`revokeAcceptanceSweepCloseAuthorisation`). The next run closes nothing. The
record keeps who allowed it and who stopped it.

It also switches itself off if the person who allowed it is deactivated or
loses `manage_backlog`, or if the Portfolio Advisor loses the grant that
permits completing backlog items.

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

## Known limit

The sweep reads each item's verdict from the same readiness view as
`get_backlog_item`. That view does not yet check the merge signal for items
still awaiting acceptance, so some items the completion step would allow may
show as not closable here. After you turn closing on, compare the
awaiting-acceptance count across two runs to see the effect.
