# PlatformIssueReport — Reach-Threshold + Staging Gate Before a Signature Becomes a BI

| Field | Value |
| ----- | ----- |
| Status | Implemented |
| Date | 2026-07-16 |
| Epic | `EP-FULL-OBS` / `EP-INTAKE-UNIFY` (intake hygiene) |
| Backlog item | BI-51F6A428 |
| Builds on | [PIR Immediate Projection (2026-06-06)](2026-06-06-pir-immediate-projection-design.md); the log-signature scanner ([`log-signature-scanner.ts`](../../../apps/web/lib/queue/functions/log-signature-scanner.ts)) + `toTemplate` normalization ([`log-signature.ts`](../../../apps/web/lib/observability/log-signature.ts)); the stream classifier ([`issue-report-stream.ts`](../../../apps/web/lib/quality/issue-report-stream.ts)) `noise-digest` stream. |
| New substrate | [`apps/web/lib/quality/issue-report-promotion.ts`](../../../apps/web/lib/quality/issue-report-promotion.ts) (pure decision); migration `20260716120000_add_pir_reach_staging_gate`. |
| Related substrate | [`platform-issue-reports.ts`](../../../apps/web/lib/quality/platform-issue-reports.ts); [`issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts); [`issue-report-triage-runner.ts`](../../../apps/web/lib/operate/issue-report-triage-runner.ts); [`issue-report-triage.ts` (cron)](../../../apps/web/lib/queue/functions/issue-report-triage.ts). |

---

## 1. Problem — the PIR treadmill

Since immediate projection (2026-06-06), an OPEN `PlatformIssueReport` mints a `BI-PIR-*`
backlog item within seconds of creation. Combined with the log-signature scanner filing ONE
report per novel error signature on its **first** occurrence, a single transient log line — a
one-cycle Loki hiccup, a benign restart FATAL that slipped the filters — became a permanent
backlog item a human had to triage and close. `toTemplate` normalization (already shipped)
collapses near-identical lines to one signature, but a genuinely one-off signature still minted
a BI on sight. There was **no reach gate**: first occurrence == backlog item.

Additionally, the dedupeKey P2002 idempotency path treated a re-occurrence as idempotent
success and returned the existing reportId **without incrementing any occurrence counter**, so a
report never accrued evidence of recurrence.

## 2. Design

### 2.1 Accrual (schema)
Four additive columns on `PlatformIssueReport` (migration `20260716120000`, all backfilled,
data-safe): `occurrenceCount Int @default(1)`, `firstSeenAt DateTime?`, `lastSeenAt DateTime?`,
`stagedUntilPromoted Boolean @default(false)`. `stagedUntilPromoted` is a **flag, not a status** —
a staged report stays `status=open`, so the existing cron OPEN-pool query keeps re-evaluating it.

### 2.2 Accrual on re-occurrence
`accrueIssueReportOccurrence(id, now)` bumps `occurrenceCount` and refreshes `lastSeenAt`. It is
called from (a) the scanner's skip-existing branch — the **primary** re-occurrence signal in
steady state — and (b) the front-door P2002 dedupeKey race. Without (a) a staged signal would
never accrue (the scanner skips existing open reports), so this is load-bearing for the safety
contract, not just the race backstop.

### 2.3 Pure promotion decision — `shouldPromoteIssueReport`
[`issue-report-promotion.ts`](../../../apps/web/lib/quality/issue-report-promotion.ts), fully
unit-tested. Policy (**conservative — this is the safety contract**):
- **high / critical severity → ALWAYS promote on first occurrence.** Never held.
- **low / medium → require the reach + recency bar**: `occurrenceCount >= 3` **AND** first→last
  span `>= 15 min` (≥ 2 distinct scan windows, guarding against a single-window burst) **AND**
  `lastSeenAt` within 60 min of now (still actively recurring). Missing accrual timestamps fail
  closed (held).

Which reports are **subject** to the bar is caller policy: only the reach-gated `noise-digest`
stream (the log-signature / warmup treadmill). Human/manual reports, crash-boundary, and runtime
faults are never held — they project on first occurrence exactly as before.

### 2.4 Gate the immediate projection (front door)
`createPlatformIssueReport` computes the stream once. A reach-gated OPEN report below the bar is
born `stagedUntilPromoted=true` and does **not** fire `quality/issue-report.created`; it accrues.
A reach-gated high/critical report (a loud incident, via `severityForCount`) clears the bar and
projects immediately. Non-gated reports are unchanged.

### 2.5 Promote / stage / age-out in triage
`triageIssueReports` gains optional deps (`shouldPromote`, `shouldExpire`, `stageReport`,
`expireStagedReport`, `maxNewPromotions`); when unset, behaviour is byte-identical to today
(always project). The runner wires them so the 15-min safety-net cron:
- **promotes** a staged report once it crosses the bar (clears the flag, mints the BI),
- **holds** a still-accruing below-bar report staged,
- **ages out** a genuinely-stopped one-off (`lastSeenAt` older than 60 min) by closing it to
  `suppressed` **without ever creating a BI** — the only path by which a staged report is dropped.

### 2.6 Per-scan-window cap
`MAX_NEW_PROMOTIONS_PER_WINDOW = 25` bounds NEW reach-gated low/medium promotions per triage run
so a runaway source cannot flood the backlog in one cycle; deferred signals stay staged for the
next window. High/critical bypass the cap.

## 3. Safety contract

A staged report is **never silently dropped** except by the explicit aging-out of a
genuinely-stopped one-off (`shouldExpireStagedReport`). Anything still recurring keeps accruing
(scanner bumps `lastSeenAt`) and eventually crosses the bar → promotes. High/critical always
project on first occurrence. The change is additive and gated behind optional deps + the
`noise-digest` stream, so every non-scanner intake path is untouched.

## 4. Verification gates

| Layer | What |
| ----- | ---- |
| Unit | `issue-report-promotion.test.ts` (all branches: high always, low below-bar, low above-bar, single-window burst, recency expiry, aging-out); `platform-issue-reports.test.ts` (staged-on-create, high-projects, manual-unaffected, firstSeenAt/lastSeenAt seeded, P2002 accrual); `issue-report-triage.test.ts` (stage / expire / promote / cap / high-bypass / no-deps-unchanged); `log-signature-scanner.test.ts` (accrue-on-skip). |
| Typecheck | `pnpm --filter web exec tsc --noEmit` (clean). |
| Functional (residual — needs live scan cycles) | Over ≥ 3 scanner cycles: a genuine recurring low signal accrues and promotes; a one-off is aged out with no BI; a high signal projects on first cycle. Requires the running platform + Loki. |

## 5. Residual / risk

- **Live scan-cycle behaviour** is not exercised by unit tests (no Loki/Inngest in-unit). The
  accrual→promotion→aging-out lifecycle needs verification across real 15-min scanner + triage
  cycles on a running install.
- **OPEN-pool `take: 100`**: staged reports share the cron's 100-row batch with promotable ones
  (ordered `createdAt asc`, so oldest/most-likely-stale first). A very large staged backlog
  (> 100 concurrently) could delay processing of the newest reports by a cycle. Acceptable for
  expected volumes; revisit with a dedicated staged-expiry sweep if staged rows pile up.
