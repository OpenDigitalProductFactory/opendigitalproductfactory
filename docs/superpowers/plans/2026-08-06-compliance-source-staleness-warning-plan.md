# Plan — Warn before AI-provider compliance evidence lapses (BI-68D44727)

- **BI:** BI-68D44727
- **Governing spec:** [`2026-06-23-human-attention-surface-design.md`](../specs/2026-06-23-human-attention-surface-design.md) §4.1 (pure projector, no materialized table)
- **Runbook produced:** [`ai-provider-compliance-source-renewal-runbook.md`](../../operations/ai-provider-compliance-source-renewal-runbook.md)

## Problem

Each governed source in the provider-compliance registry carries `retrievedAt` and its own
`maxAgeDays`. Past that window `provider-compliance-advisory.ts:135` emits `stale-source`,
grounding validation fails, and AI-provider advice degrades from a real recommendation to a
deterministic non-approval.

Failing closed is correct. Failing closed **silently** is the defect: nothing refreshed the
corpus, nothing warned first, and the three `provider-terms` sources (retrieved 2026-07-20,
60-day window) are valid only through **2026-09-18**, going stale on the 19th. On that day
the compliance coworker quietly becomes less useful on every install, with no error to read
and no owner. It surfaces as "the AI got worse", at whatever moment someone next tries to
onboard a provider.

Found by the time-bomb detector (#3899) at +365d; two failing tests were the symptom, the
registry was the cause.

## Scope

Warning plus a renewal procedure. Explicitly **not** automated re-attestation: confirming a
vendor's data-handling claims still hold, for the scope DPF applies them to, is a compliance
judgement a person owns. Automating the fetch would be possible; automating the attestation
would move a judgement into code that cannot make it.

## Phases

### 1. Freshness arithmetic (done)

`apps/web/lib/routing/provider-suitability/source-freshness.ts` — pure, registry-only, no DB
or network, injectable `now`. Returns per-source `daysUntilStale`, `staleFrom`, and a
`fresh | expiring-soon | stale` status, plus the worst status for a single badge.

`maxAgeDays` is a whole-day allowance and the guard rejects only on `ageDays > maxAgeDays`, so
a source stays valid **through** its final day. Both sides floor to UTC midnight so the answer
does not swing with render time. The boundary is asserted explicitly in tests.

Warning window: 21 days. The renewal is a scheduled human review, so the lead time has to be
weeks; much longer and the alert outlives its own urgency.

### 2. Attention projection (done)

`apps/web/lib/attention/sources/compliance-source-freshness.ts` — projects only `stale` and
`expiring-soon`. A healthy source is not news, and an inbox listing fine things trains people
to skim past it.

Same shape as the sibling `provider-credential` source (BI-282C39D5): an asset that was valid,
lapsed on a schedule, and had no proactive signal. `decideEffort: "judgment"` routes it to
"needs-you-now" through the existing `owner-routing` rules with no change there — the
re-attestation is owner/specialist work, not technical custodian work.

New `AttentionSource` key wired through the four exhaustive maps (`outside-in`,
`owner-decision-copy` ×2, `reach-message`).

### 3. Runbook (done)

The procedure: identify what is lapsing, read the current source, re-attest each claim against
its `appliesTo` scope, update the registry, verify, ship. Names the failure mode that matters
most — a claim still broadly true but no longer true for the account class or region DPF
applies it to — because that is the one a quick skim of the page misses.

## Deliberately out of scope

**No CI gate on expiry.** A required check that fails once a source lapses is a fleet-blocking
time bomb with a known detonation date — the exact failure this work exists to prevent. The
warning goes where a human can act and nowhere that can block a merge.

**A scheduled audit** (weekly cron that files a BI, mirroring `audit-time-bombs.yml`) is a
reasonable follow-up if the in-product warning proves too easy to miss. Left out here to keep
the change small and because the attention inbox is the surface the operator already watches.

## Verification

- `source-freshness.test.ts` — 9 cases, every one clock-pinned, including the exact boundary day
- `compliance-source-freshness.test.ts` — 5 cases, explicit `now`, covering silence-while-fresh,
  warn-before-break, escalate-once-lapsed, routing, and id stability
- Full `lib/attention` + `lib/proactivity` suites green (294 tests)
- Both new suites verified at +365d and +3650d — a module about expiry must not itself expire
