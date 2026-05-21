# Spend Intelligence Design

**Status:** Draft  
**Date:** 2026-05-21  
**Supersedes:** `2026-04-23-ai-provider-finance-bridge-design.md` (absorbed as Phase 1)  
**Related:** `2026-05-19-ai-cost-governance.md` (EP-COST-001, now the data foundation)

---

## 1. Problem Statement

DPF runs on AI. Every feature build, every coworker response, every inference call has a real cost — but today neither the operator nor the AI agents themselves have a clear, real-time view of what they are spending. The Finance module has contract commitments manually entered, but no live feed of actual consumption. There is no single answer to "how much have we spent this month, on what, and when will we run out?"

This is not an AI-only problem. The same blindspot exists for every supplier: cloud infrastructure, SaaS tools, contractor invoices, payment processors, marketing platforms. The business archetype drives which cost categories are load-bearing — a yoga studio cares about studio rent and booking software; a property management company cares about maintenance contractors and insurance; a software platform cares about hosting and AI tokens. Every archetype needs the same capability: **know what you're spending before you run out of money or capacity.**

### Current state gaps

| Gap | Impact |
|-----|--------|
| AI spend is estimated, not measured (prices were $0 for 69/75 models) | Cost attribution was fiction |
| No unified view across cost categories | Finance and Operations are siloed |
| No proactive alerting before limits are hit | Operators find out when inference fails |
| Subscription capacity is invisible until a 429 fires | Builds fail silently mid-run |
| Finance AP bills are manually entered, not generated from usage | AP is always stale |
| No spend forecasting | Budgets are guesses |
| Archetype cost templates don't exist | Every install starts blind |

---

## 2. Design Goals

1. **AI-first:** Accurate, real-time token consumption and cost per provider/model/agent/build with proactive capacity alerts — this is the platform's highest-cost line item and the one operators are blindest to.
2. **Unified:** One spend intelligence layer covering all cost categories (AI, infrastructure, SaaS, contractors, operations) regardless of whether the source is a token counter or a bank import.
3. **Archetype-aware:** Pre-configured cost category templates per archetype so a new install immediately has sensible budget scaffolding matching the business type.
4. **Proactive, not reactive:** Alert before the wall is hit. Surface trajectory, not just current balance.
5. **AP-connected:** Actual consumption drives draft bill generation. The AP ledger reflects reality, not manual entry.
6. **Non-invasive:** All new tables are additive. No existing Finance flows are broken.

---

## 3. Architecture

### 3.1 Data layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Intelligence   Forecasts, alerts, anomaly flags   │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Budgets        SpendBudget — period allocations   │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Rollups        SpendPeriodRollup — materialized   │
│                          actuals by category × period       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Category map   SpendCategory — taxonomy that      │
│                          links sources to budget lines       │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Raw sources    (existing — nothing deleted)       │
│  • AdapterRunTelemetry   AI token consumption + cost        │
│  • TokenUsage            Agent-level token counts           │
│  • BuildPhaseRun         Per-phase cost rollup              │
│  • BankTransaction       Bank feed actuals                  │
│  • Bill / BillLineItem   AP invoices                        │
│  • SupplierContract      Committed spend commitments        │
│  • ContractUsageSnapshot  Utilization snapshots             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 New schema (all additive)

#### `SpendCategory`
A named cost bucket that sources roll up into. Each install has a set of categories that match its archetype. Categories form a two-level tree (group → line item).

```prisma
model SpendCategory {
  id           String    @id @default(cuid())
  categoryId   String    @unique  // "ai-llm", "cloud-infra", "saas-tools", etc.
  parentId     String?            // optional group parent
  parent       SpendCategory?  @relation("CategoryTree", fields: [parentId], references: [id])
  children     SpendCategory[] @relation("CategoryTree")
  name         String
  description  String?
  unit         String?           // "USD", "tokens", "hours", "units"
  archetypes   String[]          // which archetypes this category applies to; [] = all
  sortOrder    Int      @default(0)
  isAiCategory Boolean  @default(false)  // drives AI-specific rollup sources
  createdAt    DateTime @default(now())
}
```

#### `SpendBudget`
An allocated budget for a category in a given period, set by the operator.

```prisma
model SpendBudget {
  id           String        @id @default(cuid())
  budgetId     String        @unique
  categoryId   String
  category     SpendCategory @relation(fields: [categoryId], references: [id])
  supplierId   String?       // optional — budget for a specific supplier
  periodType   String        // "monthly" | "quarterly" | "annual"
  periodStart  DateTime      // first day of the period (UTC midnight)
  periodEnd    DateTime      // last day of the period (UTC midnight)
  amountLocal  Decimal       @db.Decimal(14, 2)
  currency     String        @default("USD")
  notes        String?
  alertAt80    Boolean       @default(true)
  alertAt95    Boolean       @default(true)
  createdById  String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}
```

#### `SpendPeriodRollup`
Materialized actual spend per category per period. Computed nightly (and on demand) from the raw sources. Separates "committed" (from contracts/bills) from "metered" (from token consumption, bank feed, etc.).

```prisma
model SpendPeriodRollup {
  id              String        @id @default(cuid())
  categoryId      String
  category        SpendCategory @relation(fields: [categoryId], references: [id])
  supplierId      String?
  periodType      String        // "monthly"
  periodStart     DateTime
  periodEnd       DateTime
  committedUsd    Decimal       @db.Decimal(14, 4)  // from SupplierContract
  meteredUsd      Decimal       @db.Decimal(14, 4)  // from token counts / bank feed
  billedUsd       Decimal       @db.Decimal(14, 4)  // from Bill.totalAmount (paid invoices)
  forecastUsd     Decimal?      @db.Decimal(14, 4)  // trend-projected month-end
  callCount       Int           @default(0)         // AI: inference calls; others: 0
  tokenCount      BigInt        @default(0)         // AI: total tokens; others: 0
  computedAt      DateTime      // when this rollup was last recalculated
  sourceBreakdown Json          @default("{}")      // { anthropic: 12.50, gemini: 4.20 }

  @@unique([categoryId, supplierId, periodType, periodStart])
  @@index([categoryId, periodStart])
  @@index([periodStart])
}
```

#### `SpendAlert`
Fired when a rollup crosses a budget threshold. Deduplicated per period so one alert per threshold per period.

```prisma
model SpendAlert {
  id          String   @id @default(cuid())
  categoryId  String
  budgetId    String?
  supplierId  String?
  alertType   String   // "budget_80" | "budget_95" | "budget_exceeded" | "capacity_low" | "anomaly"
  periodStart DateTime
  ratioPercent Int
  meteredUsd  Decimal  @db.Decimal(14, 4)
  budgetUsd   Decimal? @db.Decimal(14, 4)
  message     String
  resolvedAt  DateTime?
  createdAt   DateTime @default(now())

  @@unique([categoryId, budgetId, alertType, periodStart])
  @@index([categoryId, createdAt])
}
```

#### `SpendCategoryTemplate`
Per-archetype starter pack of categories + suggested budgets. Seeded from `data/spend-category-templates.json`. Applied once at org setup time.

```prisma
model SpendCategoryTemplate {
  id             String @id @default(cuid())
  archetypeId    String
  categoryId     String
  suggestedBudgetUsd Decimal? @db.Decimal(14, 2)
  suggestedBudgetPct Decimal? @db.Decimal(5, 2)  // % of revenue
  periodType     String  @default("monthly")
  notes          String?

  @@unique([archetypeId, categoryId])
}
```

### 3.3 AI-specific capacity model

The platform cannot directly read Anthropic/OpenAI subscription capacity. Instead, it maintains a **pace model** for each subscription provider:

- **Daily token pace** = 7-day rolling average of daily token consumption (from `TokenUsage`)
- **Days in period** = days remaining in the current calendar month
- **Projected month-end tokens** = `pace × days remaining + tokens already consumed`
- **Capacity signal** = from `CliPoolStatus` (429 events) — reactive hard evidence
- **Soft capacity estimate** = operator-entered plan limit (e.g. "Claude Pro = ~100M tokens/month")

A `SubscriptionCapacityProfile` table holds the operator-entered plan limits per subscription provider. The Intelligence layer combines pace + capacity profile + 429 history to produce a `daysUntilExhaustion` estimate.

```prisma
model SubscriptionCapacityProfile {
  id                   String   @id @default(cuid())
  providerId           String   @unique
  planName             String?  // "Claude Max", "ChatGPT Pro", etc.
  monthlyTokenLimit    BigInt?  // operator estimate; null = unknown
  monthlyRequestLimit  Int?     // for request-limited APIs
  billingCycleStart    Int      @default(1)  // day-of-month cycle resets
  notes                String?
  updatedAt            DateTime @updatedAt
  createdAt            DateTime @default(now())
}
```

---

## 4. Spend Category Taxonomy

### Universal categories (all archetypes)

| categoryId | Name | Unit | AI-linked |
|---|---|---|---|
| `ai-llm` | AI / LLM Inference | USD + tokens | ✅ |
| `ai-llm.anthropic` | Anthropic (Claude) | USD + tokens | ✅ |
| `ai-llm.openai` | OpenAI / Codex | USD + tokens | ✅ |
| `ai-llm.google` | Google (Gemini) | USD + tokens | ✅ |
| `ai-llm.local` | Local inference | kWh | ✅ |
| `cloud-infra` | Cloud Infrastructure | USD | — |
| `saas-tools` | SaaS Tools | USD | — |
| `payment-processing` | Payment Processing | USD + % | — |
| `comms` | Communications (email, SMS) | USD | — |
| `storage` | Storage & Backup | USD + GB | — |

### Archetype-specific overlays

Selected examples — seeded from `spend-category-templates.json`:

**`hoa-property-management`**
| categoryId | Name |
|---|---|
| `maintenance` | Property Maintenance |
| `landscaping` | Landscaping & Grounds |
| `insurance` | Property Insurance |
| `management-fee` | Management Company Fee |
| `reserve-fund` | Reserve Fund Contribution |
| `utilities` | Common Area Utilities |
| `legal-compliance` | Legal & Compliance |

**`software-platform`**
| categoryId | Name |
|---|---|
| `hosting` | Hosting & CDN |
| `observability` | Monitoring & Observability |
| `security` | Security & Compliance Tools |
| `developer-tools` | Developer Tools |
| `ci-cd` | CI/CD Pipeline |
| `data-warehouse` | Data & Analytics |

**`professional-services`**
| categoryId | Name |
|---|---|
| `contractor-labour` | Contractor Labour |
| `professional-liability` | Professional Liability Insurance |
| `project-tools` | Project & Collaboration Tools |
| `travel-expenses` | Travel & Expenses |

**`food-hospitality`**
| categoryId | Name |
|---|---|
| `food-cogs` | Food & Beverage COGS |
| `packaging` | Packaging |
| `pos-payments` | POS & Payments |
| `delivery-platform` | Delivery Platform Fees |
| `kitchen-maintenance` | Kitchen Equipment & Maintenance |

**`healthcare-wellness`**
| categoryId | Name |
|---|---|
| `ehr-software` | EHR / Practice Management Software |
| `medical-supplies` | Medical & Clinical Supplies |
| `professional-insurance` | Professional Indemnity Insurance |
| `compliance-tools` | Regulatory & Compliance Tools |

---

## 5. Rollup computation

The nightly rollup job (`computeSpendRollups`) runs at 00:05 UTC and materialises `SpendPeriodRollup` for the current and prior month. For each `SpendCategory`:

### AI categories (`isAiCategory = true`)
```sql
-- meteredUsd: sum estimatedCostUsd from AdapterRunTelemetry for the period
SELECT SUM(COALESCE("estimatedCostUsd", 0)) FROM "AdapterRunTelemetry"
  WHERE "startedAt" BETWEEN periodStart AND periodEnd
  AND "providerId" MATCHES category.providerPattern
```

### Subscription categories (cost = $0 per token)
```
meteredUsd = 0
committedUsd = SupplierContract.monthlyCommittedAmount for the provider
```

### Non-AI categories
- **committedUsd** = active `SupplierContract.monthlyCommittedAmount` for suppliers tagged to this category
- **billedUsd** = paid `Bill.totalAmount` for bills linked to suppliers in this category, in the period
- **meteredUsd** = matched `BankTransaction.amount` for transactions categorised to this category

### Forecasting
For the current period only:
```
daysElapsed = today - periodStart
daysTotal = periodEnd - periodStart
forecastUsd = (meteredUsd / daysElapsed) × daysTotal
```
Linear interpolation; future phases will use a rolling-average model for categories with variable demand.

---

## 6. AI Capacity Pace Model

For subscription providers (`inputPricePerMToken = 0`):

```typescript
// Daily pace: rolling 7-day average
const pace = await prisma.tokenUsage.aggregate({
  where: { providerId, createdAt: { gte: sevenDaysAgo } },
  _sum: { inputTokens: true, outputTokens: true },
});
const dailyPace = (pace._sum.inputTokens + pace._sum.outputTokens) / 7;

// Days remaining in billing cycle
const daysRemaining = billingCycleEnd - today;

// Projected month-end consumption
const projected = tokensConsumedMTD + (dailyPace * daysRemaining);

// Capacity pressure
const capacityPct = monthlyTokenLimit
  ? Math.round((projected / monthlyTokenLimit) * 100)
  : null;

// daysUntilExhaustion (null = no limit configured)
const daysUntilExhaustion = monthlyTokenLimit && dailyPace > 0
  ? Math.floor((monthlyTokenLimit - tokensConsumedMTD) / dailyPace)
  : null;
```

The pace model is written to `ContractUsageSnapshot` (reusing the existing schema), with `sourceType = "internal_pace_model"`.

---

## 7. UI Surface

### 7.1 Finance > AI Spend (extend existing page)

Extend the current page with:

| Section | What it shows |
|---|---|
| **Capacity heat map** | One tile per AI provider: tokens consumed MTD, daily pace, days-until-exhaustion estimate, last 429 timestamp |
| **Metered vs committed** | Bar chart: estimated metered cost vs contract commitment, by provider |
| **Per-build cost** | Table from `BuildPhaseRun`: top 10 most expensive builds this month |
| **Per-agent cost** | Table from `TokenUsage + AdapterRunTelemetry` grouped by agent |
| **Model cost distribution** | Treemap: which models are generating the spend |

### 7.2 Finance > Spend (new unified dashboard)

New top-level spend dashboard replacing the current stub. One page, three panels:

**Panel A — Budget vs Actual (current month)**
Table: Category | Budget | Committed | Metered | Billed | Forecast | Status  
Status = green/amber/red based on `forecastUsd / budgetAmountUsd`

**Panel B — Trend chart**  
Line chart: last 6 months of total spend by category group. Spot month-over-month changes.

**Panel C — Alerts**
Active `SpendAlert` rows: what needs attention now.

### 7.3 Finance > Spend > [Category]**  
Drill-down: all suppliers contributing to the category, their contracts, usage snapshots, recent bills, and the spend history chart.

### 7.4 Admin > Platform > Spend Setup**
One-time setup flow (shown on fresh install):
1. Confirm archetype → load category template
2. Review suggested categories → activate/skip
3. Enter initial budgets per category
4. Enter subscription plan limits (Claude token limit, etc.)

---

## 8. AP Bill Auto-generation

When `SpendPeriodRollup` is computed for a closed period (prior month), the system:

1. Checks if a `Bill` already exists for each supplier in the period (idempotent)
2. If not, calls `generateDraftBillForAiContract()` (already exists in `ai-provider-finance.ts`)  
3. For non-AI suppliers: creates a `Bill` in `draft` status from `billedUsd` if a `BankTransaction` match exists, or from `committedUsd` if no bank match is found
4. Finance team reviews and approves — no auto-posting to paid

This closes the gap between actual consumption and the AP ledger without bypassing human approval.

---

## 9. Schema Changes Summary

| Table | Change | Migration |
|---|---|---|
| `SpendCategory` | New — cost category taxonomy | New table |
| `SpendBudget` | New — operator budget allocations | New table |
| `SpendPeriodRollup` | New — materialised actuals + forecast per category | New table |
| `SpendAlert` | New — threshold crossing events | New table |
| `SpendCategoryTemplate` | New — archetype seed templates | New table |
| `SubscriptionCapacityProfile` | New — operator-entered plan limits | New table |
| `Supplier` | Add `spendCategoryId String?` | Additive column |
| `Bill` | Add `spendCategoryId String?` | Additive column |
| `BankTransaction` | Add `spendCategoryId String?` | Additive column |

All migrations are additive. No existing columns are altered.

---

## 10. Implementation Phases

### Phase 1 — AI Spend Intelligence (~2 weeks)
**Goal:** Complete, accurate real-time view of AI costs with proactive capacity alerting.

1. Add `SubscriptionCapacityProfile` table + seed UI (Admin > Platform > Spend Setup, AI section only)
2. Add `SpendCategory` seed for `ai-llm` tree (Anthropic, OpenAI, Google, Local)
3. Add `SpendBudget` CRUD for AI categories
4. Implement `computeSpendRollups()` for AI categories only — reads `AdapterRunTelemetry` + `SupplierContract`
5. Implement pace model → write to `ContractUsageSnapshot` nightly
6. Extend Finance > AI Spend: capacity heat map, per-build cost table, per-agent cost table, model cost treemap
7. `SpendAlert` generation for AI budget thresholds + capacity pressure
8. Notification: coworker surfaces "approaching capacity" warning when `daysUntilExhaustion < 7`

**Deliverable:** Operator can see current AI spend, capacity trajectory, and gets warned before inference starts failing.

### Phase 2 — Unified Spend Intelligence (~3 weeks)
**Goal:** All cost categories visible in one place, budgets tracked, AP bills auto-drafted.

1. Full `SpendCategory` taxonomy seed (all universal categories)
2. `SpendPeriodRollup` for non-AI categories (bank feed + bills + contracts)
3. `Supplier.spendCategoryId` + `Bill.spendCategoryId` + `BankTransaction.spendCategoryId` migrations
4. Finance > Spend unified dashboard (budget vs actual, trend chart, alerts panel)
5. AP bill auto-generation from closed-period rollup (draft only, human approval required)
6. `SpendAlert` for all categories

**Deliverable:** Single view of all costs, AP ledger is auto-populated from actuals.

### Phase 3 — Archetype Cost Templates (~1.5 weeks)
**Goal:** New installs get sensible budget scaffolding matching their business type.

1. `SpendCategoryTemplate` seed covering all 9 archetype categories (45 archetypes)
2. Admin > Platform > Spend Setup wizard: archetype → category template → budget entry → subscription plan limits
3. Suggested budget amounts seeded from industry benchmarks (as a starting point, editable)
4. Finance > Spend > [Category] drill-down page

**Deliverable:** Fresh install of any archetype has cost categories, suggested budgets, and is immediately operational.

### Phase 4 — Forecasting & Anomaly Detection (~2 weeks)
**Goal:** Move from reactive to predictive.

1. Rolling-average forecast model replacing linear interpolation for variable-demand categories
2. Month-over-month variance alerts (>20% change triggers anomaly `SpendAlert`)
3. Seasonal adjustment for archetypes with known seasonality (restaurants, gyms, etc.)
4. Trend chart with forecast overlay in Finance > Spend dashboard
5. Budget recommendation engine: suggest budget adjustments based on 3-month actuals

**Deliverable:** Operator is warned about unexpected spend trajectory, not just current balance.

---

## 11. Open Questions

1. **Subscription token limits:** Anthropic doesn't publish exact token limits per plan. The platform will accept operator-entered estimates. Should there be a crowd-sourced default per plan tier (e.g. "Claude Pro ≈ 200M tokens/month") in the seed? **Decision needed.**

2. **Multi-currency:** `SpendPeriodRollup` is denominated in USD. For installs using GBP/EUR as base currency, should rollups be stored in local currency, USD, or both? **Recommend USD + display conversion.**

3. **BankTransaction → category auto-assignment:** Should there be an ML-based auto-categorisation of bank transactions by merchant name? Useful for Phase 2 but adds complexity. **Defer to Phase 5 unless the bank feed already has categories.**

4. **Budget ownership:** Can budgets be owned by an employee (team budget) or only at the org level? IT4IT TBM model supports both. **Recommend org-level for Phase 1-2, team-level in Phase 4.**

5. **Revenue percentage budgets:** `SpendCategoryTemplate` has `suggestedBudgetPct` (% of revenue). This requires a revenue figure. Should it come from `BankTransaction` classified as revenue, or manual entry? **Manual entry for Phase 3; auto-derive in Phase 4.**

---

## 12. Success Metrics

| Metric | Before | Target (Phase 1) | Target (Phase 3) |
|---|---|---|---|
| Time to know current AI spend | Never / manual calc | < 1 min on dashboard | < 1 min |
| AI capacity exhaustion warnings | 0 (reactive 429) | 7-day advance warning | 7-day advance warning |
| AP bills auto-drafted from actuals | 0% | 100% for AI contracts | 100% for all contracts |
| Fresh install time to first budget | Weeks / never | — | < 30 min (setup wizard) |
| Month-over-month spend variance visibility | None | AI only | All categories |
