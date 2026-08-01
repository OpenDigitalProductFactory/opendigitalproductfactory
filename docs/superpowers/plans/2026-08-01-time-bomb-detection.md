---
title: Time-bomb detection — dynamic, not static
authoredAt: 2026-08-01
authoredBy: mark-bodman
backlogItem: BI-6A4F47B9
---

# Time-bomb detection

## What happened

At **2026-08-01T15:00:00Z** `apps/web/lib/healthcare/care-intake-api-repository.test.ts`
began failing on every branch simultaneously. Its fixture carried
`expiresAt: new Date("2026-08-01T15:00:00.000Z")` while the code under test rejects an
expiry that is not in the future, and its `describe` was the only block in the file that did
not pin the clock. At that instant the literal became the past.

`Unit Tests (web shard 1/4)` is a required check, so **every PR in the repository was
blocked**, and rerunning could not help. Three sessions converged on it independently
(#3883, #3885, and a third closed as duplicate) — which is itself evidence of how much
confusion it caused: it presents as "my branch broke an unrelated area".

The one-line fix shipped. This plan covers the part that stops the next one.

## Why the obvious sweep was rejected

The natural follow-up is "grep for fixtures with a future `new Date("20…")` and no
`useFakeTimers`". That was **measured on this repo, not assumed**:

- 29 files matched.
- The 5 most imminent were run — including one whose date had **already elapsed**.
- **38 tests, all passing.**

A future date in a fixture is inert unless something compares it to the current time. The
heuristic over-reports roughly 6:1. Acting on it would mean churn across several teams'
tests, would prevent nothing, and — worst — would manufacture confidence that the class had
been dealt with.

## What is built instead

Run the suite twice and take the set difference. A test that passes now and fails at now+N
**is** a bomb, by definition. No heuristic, no judgement, and benign fixtures produce no
noise.

| Piece | What it does |
|---|---|
| `apps/web/vitest.clock-shift-setup.ts` | Shifts `Date.now()` and bare `new Date()` by `DPF_CLOCK_SHIFT_DAYS`. A strict no-op when the var is unset. |
| `scripts/detect-time-bombs.mjs` | Runs baseline + each horizon, diffs failing test ids, reports only the difference. |
| `apps/web/lib/testing/clock-shift.test.ts` | Proves the shim shifts *now* only, leaves explicit dates alone, and stays inert when disabled. |
| `.github/workflows/audit-time-bombs.yml` | Weekly at +30/+90/+365d; files a tracking issue; also runs on PRs that touch the detector. |

### Design decisions worth keeping

**Shift `Date`, never timers.** Faking timers across a whole suite changes async scheduling
and would produce failures that are artifacts of the harness rather than real bombs.

**Only a bare `new Date()` moves.** An explicitly-constructed date is the fixture under
test; shifting it too would keep the comparison in the same relative position and hide the
very thing being looked for.

**A test that pins its own clock is immune, and should be.** Pinning is the fix, so a pinned
test correctly reports clean.

**Scheduled, not per-PR.** It runs the suite once per horizon plus a baseline — far too slow
for the merge path, and a 30-day horizon gives weeks of warning.

**A harness failure is not a clean result.** Zero collected tests or an unreadable report
exits 2 and fails the workflow. A detector that silently stops detecting is worse than none,
so the workflow also re-runs the shim's own tests before trusting a green sweep.

## Verified functionally, not structurally

- Planted a probe with a bomb **and a benign control** in one file. The detector reported
  the bomb and **not** the control — the precise over-reporting failure the static sweep had
  — and exited 1.
- Removed the probe: exits 0, reports clean.
- Shim unit tests: 8/8.

## Not done

- Only `apps/web` is swept. `packages/**` suites have their own vitest configs and would
  each need the setup file wired; worth doing if a bomb ever lands there.
- The horizons (30/90/365) are a guess at useful lead time, not a measured choice.
