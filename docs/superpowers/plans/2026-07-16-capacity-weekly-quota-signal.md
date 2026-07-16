# Capacity Drain — Real Weekly-Quota Signal (replace the exhaustion proxy)

**Date:** 2026-07-16
**Epic:** EP-DEMAND-MGMT (capacity automation follow-up)
**Kernel decision:** capacity-weekly-quota-signal-build — `substrate-plus-policy-seam`
(consulted `principle_decide`; commandments *Never Assume — Verify*, *Least
privilege*, *Never adopt an unvetted external tool*, *Architecture Over Shortcuts*,
*Do the work* ruled out both the blind full-live-collection option and the
minimal-only option).

## Problem

The use-it-or-lose-it capacity-drain automation (PR #3060, BI-656F4E4B) shipped on
a **proxy** signal: "the CLI pool has not been rate-limited (`CliPoolStatus` not
exhausted) and we're inside a fixed-day-of-week reset window, so there's probably
unspent weekly allocation worth draining." The proxy existed because we assumed the
provider does not expose remaining weekly quota.

Research disproved both halves of that assumption:

1. **The provider DOES expose remaining weekly quota** — it's the same number every
   Claude/Codex subscription client renders:
   - Anthropic: `anthropic-ratelimit-unified-7d-*` response headers on every
     `/v1/messages` response (`-utilization` 0..1, `-reset` unix), plus tier
     variants (`7d_opus`, `7d_sonnet`); and `GET /api/oauth/usage`
     → `{ seven_day: { utilization, resets_at } }`.
   - Codex: `codex app-server` JSON-RPC `account/rateLimits/read`
     → `{ rateLimits: { secondary: { usedPercent, resetsAt } } }` (secondary = weekly).
2. **The reset is NOT a fixed calendar day** — community monitoring showed a rolling
   ~72h anchored window; the provider-supplied `resetsAt` is authoritative, so the
   locally-computed fixed-DOW boundary is only a fallback.

## Design (this PR)

Pure spine + corrected policy + one topology-free live path + one documented seam.

- **`lib/routing/weekly-quota.ts`** (pure, no server imports): normalize all three
  provider shapes into one `WeeklyQuotaSnapshot { utilization, resetAt, source,
  observedAt }`. `parseUnifiedRateLimitHeaders` (most-restrictive weekly window),
  `parseOAuthUsageJson`, `parseCodexRateLimitsJson`, `coerceResetDate`,
  `deriveRemainingRatio`, `isWeeklyQuotaFresh` (30m staleness gate).
- **Schema:** additive-nullable `weeklyUtilization/weeklyResetAt/weeklySource/
  weeklyObservedAt` on `CliPoolStatus` (migration
  `20260716120000_add_cli_pool_weekly_quota`). Fleet-safe.
- **`lib/routing/cli-pool-status.ts`:** `recordCliWeeklyQuota` writer; `CliPoolState`
  carries the weekly fields; `clearCliRateLimit` now **preserves** a weekly snapshot
  (clears only exhaustion) so a successful call doesn't wipe the quota reading;
  `captureAnthropicWeeklyQuota` (topology-free live capture from success headers).
- **`lib/routing/chat-adapter.ts`:** on a successful Anthropic response, fire-and-
  forget `captureAnthropicWeeklyQuota(res.headers)` — no-op when the unified headers
  are absent (API-key traffic isn't on the weekly meter).
- **`lib/capacity/drain-policy.ts`:** `evaluateDrain` consumes `weeklyRemainingRatio`
  (from a fresh snapshot) and scales dispatch to how much is left; stops below a
  `minRemainingToDrain` floor (the honest replacement for `poolExhausted`); a 429 in
  flight remains a hard stop. Falls back to the proxy when no fresh snapshot. Reports
  `signal: "real" | "proxy"`. `nextWeeklyReset` demoted to fallback.
- **`lib/capacity/evaluate-drain.ts`:** reads the most-restrictive fresh weekly
  snapshot across adapters; provider `resetAt` becomes the drain window boundary;
  surfaces `weeklyRemainingRatio` + `weeklySource` on the result.

## Seam (follow-up)

`collectCliWeeklyQuota(adapterType)` in `cli-pool-status.ts` is a documented stub for
the two CLI-native collectors (read container OAuth creds → `/api/oauth/usage`;
spawn `codex app-server` → `account/rateLimits/read`). Left unwired because live
collection depends on per-install container/credential topology that could not be
verified in this autonomous build. Both endpoints are undocumented and their auth
headers have changed before, so the collector must treat a failed/parse-less read as
"no signal," never "plenty of quota."

## Tests

`weekly-quota.test.ts` (21), `cli-pool-status.test.ts` (+quota/capture/preserve),
`drain-policy.test.ts` (+real-signal), `evaluate-drain.test.ts` (picker/staleness).
