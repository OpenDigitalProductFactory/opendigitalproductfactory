---
status: active
---

# Subscription token value and paired-install usage (BI-6361A930)

Extends the subscription effective-cost estimator from PR #7019 (BI-F98BBE4F).
Delivery shape: medium. One deliverable, one PR.

## Problem

Finance > AI Spend > Subscription costs shows each plan's fee and its effective
cost per million tokens. It does not show what the plan's usage would have cost
at pay-per-token prices, so there is no savings figure. It also counts only
this install's usage, while the owner's plans are shared with the paired Dev
install. Production therefore spreads the whole fee over part of the usage, and
a plan used only on Dev (Google) shows no usage at all.

## Research

Comparable implementations:

- **T3 Code** (the owner's cited approach) records each call's tokens and prices
  them at the provider's API rate to show what a plan's usage is worth.
- **ccusage** (open source Claude Code usage reporter) values Claude Max/Pro
  usage at Anthropic API list prices per input and output token, against the
  plan fee.
- **LiteLLM spend tracking** prices every call from a per-model input/output
  price table.

Standard followed: each provider's published per-million-token input and output
list price. DPF already records them on `ModelProvider`.

Adopted: value = input tokens × input list price + output tokens × output list
price, per provider, summed per plan. Savings = value − fee.

Rejected:

- Importing LiteLLM's price table. It would be a second home for prices and a
  vendor dependency.
- Per-model pricing. `TokenUsage` records no model, so the provider's price is
  used, and the panel says so.

## Design

### List price

A provider's own non-zero input and output prices win. A subscription provider
recorded at $0 uses its pay-per-token sibling, declared in one map in the
estimator: `anthropic-sub → anthropic`, `chatgpt → openai`. Otherwise the
provider is unpriced: its tokens still count toward capacity, but the value is
marked partial and names the unpriced provider.

### Paired-install usage

Options considered:

1. Pull the peer's usage live while the Finance page renders. Rejected: the page
   would be slow and would fail whenever the peer does.
2. The peer pushes usage through the federation outbox. Rejected: it adds
   delivery state for what is only a read model.
3. **Chosen:** pull on the existing work-sync cadence (every 5 minutes) over the
   same trusted same-organization link and token as
   `GET /api/v1/federation/work`. Keep the last pull in `PlatformConfig` (key
   `federation.ai-usage.peer.v1`). No schema change.

The serving route is `GET /api/v1/federation/ai-usage`. Like the work route, it
is open only to a same-organization peer. It returns this install's own
`TokenUsage` and rate-limit hits for the last 30 days in hourly buckets per
provider. It never re-serves usage pulled from a peer, so nothing is counted
twice.

The receiver re-buckets hours into each plan's reset window and merges them
with local windows. Every figure is attributed to the install it ran on. The
fee comes only from the local contract, so it is counted once.

### Honest degrade

- **Peer never answered:** the panel says the paired install's usage is missing
  and why: not reachable, not yet updated to share usage, or refused. Confidence
  drops to low, because the fee is spread over too little usage.
- **Last good pull older than 1 hour:** the panel says the usage is as of that
  time.
- **A plan with no usage on either install:** reported as before.

## Steps (test-first)

1. Pure estimator: tests for list-price valuation, a plan shared by two
   installs, a plan used only on the peer, and peer-missing confidence. Then
   implement `valueUsageAtListPrice`, `rebucketHourly` and
   `estimateSubscriptionPlan`.
2. Peer usage contract, plus a pure serving builder and receiver (validation,
   health merge). Tests, then implementation. Add the route, and a sync step
   on the demand-reconciliation cadence after work sync.
3. Loader: combine local and peer usage and pass list prices.
4. Panel: value, fee, savings, effective cost, confidence, per-install
   attribution and peer status. i18n keys, panel tests.
5. Gates: unit tests, typecheck, `pnpm land`, `pnpm gate:wait`.

## Acceptance

See the Acceptance section of BI-6361A930 (AC-1 to AC-4).
