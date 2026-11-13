# Subscription cost estimator v1 (BI-F98BBE4F)

Epic EP-INPLATFORM-CODING, milestone M1. The owner's direction is quoted in BI-F98BBE4F.


## Design note (estimator v1, 2026-11-12)

**Problem.** Subscription calls are recorded at $0 (anthropic-sub and chatgpt record 0/0 prices) or at an unrelated list price (codex 1.5/6). No fee is on file, and nothing divides a fee by usable capacity.

**Options considered.**
1. Store a per-token price on ModelProvider for each subscription. Rejected: it freezes a guess in config and ignores resets.
2. A new fee table. Rejected: the fee already has a home. The existing "Record AI subscription payment" form writes an active SupplierContract (contractType subscription, monthlyCommittedAmount, billingCadence, coveredProviderIds) and AiProviderFinanceProfile.monthlyBudget.
3. **Chosen:** a pure estimator over existing data. Fee = the active subscription contract covering the provider (monthly-normalised), shared across its covered providers. Usage = TokenUsage. Limit hits = RouteOutcome rate_limit rows. The last 30 days are bucketed into the provider's reset window (5 h default). A window with a limit hit shows what one window holds. A lockout that spans many windows drags that figure down, so a strict-reset provider comes out dearer and a generous-reset provider cheaper. Usable monthly capacity: low = observed use; point = median limited-window tokens x active windows; high = p90 limited-window tokens x active windows (never below observed use). Effective cost per million tokens = fee / capacity, reported as high/point/low with a confidence (high: 5+ limited windows over 14+ days; medium: 1+ over 7+ days; low otherwise). With no limit hit, the point is a ceiling and confidence is low.

**Spend classification (coordinates with PR #6869).** logTokenUsage records a subscription-covered call at the point estimate, not $0. Per WWMD DI-223FEAA53080 (the portfolio-management profession, DI-BCD7A4098D65, was low-confidence and left an interim), subscription usage counts against portfolio budgets only. The daily paid-AI allowance keeps governing marginal cash: budget-gate treats subscription-covered providers as zero-marginal, so the allowance neither counts nor refuses them. A provider with no recorded fee keeps today's behaviour, and the finance page asks for the fee.

**Recovery.** Kept as is: the hourly ScheduledJob recheck (subscription-quota-recovery.ts) and routing re-admission when retryAt passes (capacity-routing-exclude.ts). Tests are added for both.

**Out of scope (v1).** Routing on effective cost and latency (item 4). Per-portfolio budget attribution (BI-7138C61B).

## Acceptance

- AC-1: The estimator turns fee, usage and limit-hit observations into fee / usable capacity, as low, point and high USD per million tokens with a confidence. With the same fee and usage, a strict-reset provider estimates dearer than a generous-reset one. Unit-tested.
- AC-2: The fee comes from the active subscription contract covering the provider, monthly-normalised and shared across its covered providers. With no fee, the estimate says the fee is not recorded and gives no cost.
- AC-3: logTokenUsage records a subscription-covered call at the point estimate, not $0. Tested.
- AC-4: The daily paid-AI allowance and the agent token cap neither count nor refuse subscription-covered usage (DI-223FEAA53080). Tested.
- AC-5: The finance AI spend page shows each subscription's fee, estimated cost band and confidence, or asks for the fee.
- AC-6: Tests show that a due hourly recheck runs on a limited subscription and schedules the next one, and that a rate-limited subscription is routable again the moment its retryAt passes.
