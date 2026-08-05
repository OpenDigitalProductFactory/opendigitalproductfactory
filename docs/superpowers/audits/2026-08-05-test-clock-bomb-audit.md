---
title: Test clock-bomb audit
date: 2026-08-05
backlog: BI-E104FBCC
status: complete
---

# Test clock-bomb audit

## What a clock bomb is

A test fixture pins a hardcoded date — `expiresAt: new Date("2026-08-01T15:00:00Z")` —
and the code under test rejects a value that is not in the future. The test passes for
months, then wall-clock crosses that instant and it fails on **every open PR at once**.
It is not a flake, and no PR causes it.

Twice already: #3834 (mcp-api-token rotation) and
`lib/healthcare/care-intake-api-repository.test.ts`, which detonated at
2026-08-01T15:00Z and blocked the fleet.

## The guard

`scripts/check-test-clock-bombs.mjs`, registered as **Test Clock Bomb Guard** in
`scripts/lib/ci-policy-guards.mjs`. Two design constraints, both established by
measurement rather than assumption:

**Time-independent.** The obvious rule — "flag dates in the future" — would make the
guard itself a clock bomb: its verdict would change with the calendar, so a clean tree
could go red overnight and a planted bomb would go *quiet* the moment it detonated. The
guard never compares anything to the current time. It matches a pattern: a hardcoded
absolute date bound to a field whose semantics require a future value, in a file that
never controls the clock.

**Scoped to added lines.** Measured repo-wide, that pattern matches **185 fixtures
across 93 files**, overwhelmingly legitimate — dates already in the past that exist to
exercise the expired branch. Gating on that would need a 93-file baseline, which is the
silent allowlist the guard exists to replace. Worse, firing on lines an author never
wrote would block unrelated work and get the guard disabled within a week. So it
inspects only lines the current change **adds**.

Both directions are proven, not assumed:

| Scenario | Result |
| --- | --- |
| New unpinned `expiresAt` added in a diff | exit 1, line reported |
| Unrelated edit to a file with a pre-existing fixture | exit 0 |

### Clock control includes injection, not just fake timers

Assuming `useFakeTimers` was the only idiom was wrong, and the audit's most alarming
finding is the proof. `lib/auth/edge-node-mtls.test.ts` holds a certificate expiring
2026-08-21 — sixteen days out when audited — against code that does
`certificate.validUntil.getTime() <= now.getTime()`. It is completely safe:
`resolveEdgeNodeMtls` takes an explicit `now` and the test passes a fixed one, so the
wall clock is never read. Flagging it would have pushed an author to "fix" a test that
was already correct. The guard therefore treats `now:` / `asOf` / `referenceDate` /
`clock:` injection as clock control.

## Audit findings

Filtering to fixtures that are **both** future-dated and have no clock control at all
leaves **25 findings across 12 files**:

| File | Dates |
| --- | --- |
| `lib/actions/crm-commercial.test.ts` | 2026-08-31 ×2 |
| `lib/actions/finance-invoice-lifecycle.test.ts` | 2026-09-01 |
| `lib/work-capture/recurrence-expander.test.ts` | 2026-12-01, 2030-01-01 |
| `lib/govern/data/coverage.test.ts` | 2026-12-31 ×2, 2027-06-30 |
| `lib/assurance/advisory-context.test.ts` | 2026-12-31 |
| `packages/db/src/healthcare-patient-authority.test.ts` | 2026-12-31 |
| `lib/workforce/staffing/constraints/evaluate.test.ts` | 2027-01-01 |
| `lib/workforce/staffing/solver/adapter.test.ts` | 2027-01-01 |
| `lib/actions/licensing-compliance.test.ts` | 2027-05-01 |
| `lib/actions/users.test.ts` | 2099-03-14 ×2 |
| `lib/auth/mcp-api-token.test.ts` | 2999-01-01 ×2 |

### These are candidates, not confirmed bombs

**No fixture in this table was mass-edited, deliberately.** Identifier matching finds
where a date *could* be load-bearing; only the code under test decides whether it is.
The nearest-dated candidate demonstrates the gap: `crm-commercial.test.ts` passes
`validUntil: "2026-08-31"` to `createQuote`, which merely stores
`new Date(input.validUntil)` — nothing requires it to be ahead of now, and the one
comparison that exists (`lib/crm/account-attention.ts:131`) takes an injected `now`.
That fixture is inert. Rewriting it would have been churn presented as a fix.

Confirming a bomb requires reading the code under test for each fixture and asking
whether it compares the value to the real clock **and** requires future-ness. That is
per-file work, and the far-future sentinels (`2099`, `2999`, `2030`) will in practice
never detonate and want a stated `clock-bomb-guard: allow` exemption rather than a
rewrite.

The guard makes this a shrinking problem regardless: no new bomb can be added without
the author either pinning the clock, making the fixture relative, or stating why it is
safe.

## How to clear a finding

1. Pin the clock in the enclosing describe — `vi.useFakeTimers()` plus
   `setSystemTime(...)` — matching what neighbouring suites already do.
2. Or make the fixture relative: `new Date(Date.now() + 3_600_000)`.
3. Or annotate the line `clock-bomb-guard: allow <reason>` so the exemption is stated
   rather than silent.
