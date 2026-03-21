# Financial Management Phase G: Asset Management & Multi-Currency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a fixed asset register with depreciation schedules, and multi-currency transaction support with transparent FX calculations — per-transaction currency (not per-contact), auto-fetched exchange rates, and realized FX gain/loss on payment allocation.

**Architecture:** New Prisma model (FixedAsset) plus an OrgSettings model for base currency. Server actions in `lib/actions/assets.ts` and `lib/actions/currency.ts`. Exchange rates fetched from ECB (free, no API key) or manual override. FX gain/loss calculated at payment allocation time by comparing invoice rate to payment rate.

**Tech Stack:** Prisma, Next.js, Vitest, fetch (ECB XML feed), existing finance infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (items 17-18)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 6.1-6.3)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/assets.ts` | Fixed asset CRUD, depreciation calculation |
| `apps/web/lib/actions/assets.test.ts` | Tests |
| `apps/web/lib/actions/currency.ts` | Exchange rate fetching, FX gain/loss calculation |
| `apps/web/lib/actions/currency.test.ts` | Tests |
| `apps/web/lib/asset-validation.ts` | Zod schemas |
| `apps/web/lib/asset-validation.test.ts` | Tests |
| `apps/web/app/(shell)/finance/assets/page.tsx` | Asset register list |
| `apps/web/app/(shell)/finance/assets/new/page.tsx` | Create asset |
| `apps/web/app/(shell)/finance/assets/[id]/page.tsx` | Asset detail with depreciation schedule |
| `apps/web/components/finance/CreateAssetForm.tsx` | Client form |
| `apps/web/app/(shell)/finance/settings/currency/page.tsx` | Currency settings (base currency, exchange rates) |
| `apps/web/app/api/v1/finance/assets/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/assets/[id]/route.ts` | GET detail + PATCH |
| `apps/web/app/api/v1/finance/exchange-rates/route.ts` | GET current rates |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add FixedAsset, ExchangeRate, OrgSettings models |
| `apps/web/app/(shell)/finance/page.tsx` | Add assets widget and currency info |

---

## Task 1: Prisma Models

Append to schema:

```prisma
// ─── Finance: Asset Management ─────────────────────────────────────

model FixedAsset {
  id                      String    @id @default(cuid())
  assetId                 String    @unique
  name                    String
  category                String
  purchaseDate            DateTime
  purchaseCost            Decimal
  currency                String    @default("GBP")
  depreciationMethod      String    @default("straight_line")
  usefulLifeMonths        Int
  residualValue           Decimal   @default(0)
  currentBookValue        Decimal
  accumulatedDepreciation Decimal   @default(0)
  status                  String    @default("active")
  disposedAt              DateTime?
  disposalAmount          Decimal?
  location                String?
  assignedToId            String?
  serialNumber            String?
  notes                   String?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  @@index([status])
  @@index([category])
}

// ─── Finance: Multi-Currency ───────────────────────────────────────

model ExchangeRate {
  id          String    @id @default(cuid())
  baseCurrency String
  targetCurrency String
  rate        Decimal
  source      String    @default("ecb")
  fetchedAt   DateTime  @default(now())

  @@unique([baseCurrency, targetCurrency, fetchedAt])
  @@index([baseCurrency, targetCurrency])
}

model OrgSettings {
  id              String    @id @default(cuid())
  baseCurrency    String    @default("GBP")
  autoFetchRates  Boolean   @default(true)
  lastRateFetchAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

Run migration, generate, commit: `feat(finance): add FixedAsset, ExchangeRate, OrgSettings models`

---

## Task 2: Validation Schemas

Create `apps/web/lib/asset-validation.ts` and tests.

```typescript
export const ASSET_CATEGORIES = ["equipment", "vehicle", "furniture", "IT", "property", "other"] as const;
export const DEPRECIATION_METHODS = ["straight_line", "reducing_balance"] as const;
export const ASSET_STATUSES = ["active", "disposed", "written_off"] as const;

export const createAssetSchema = z.object({
  name: z.string().min(1),
  category: z.enum(ASSET_CATEGORIES),
  purchaseDate: z.string().min(1),
  purchaseCost: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).default("straight_line"),
  usefulLifeMonths: z.number().int().positive(),
  residualValue: z.number().min(0).default(0),
  location: z.string().optional(),
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const disposeAssetSchema = z.object({
  disposalAmount: z.number().min(0),
  disposedAt: z.string().optional(),
});
```

TDD. Commit: `feat(finance): add validation schemas for assets and currency`

---

## Task 3: Asset Management Actions

Create `apps/web/lib/actions/assets.ts` and tests.

**Functions:**

`createAsset(input)` — generate FA-{nanoid(8)}, set currentBookValue = purchaseCost.

`getAsset(id)` — findUnique with depreciation schedule calculated.

`listAssets(filters?)` — filter by status/category.

`calculateDepreciation(asset)` — pure function. Returns monthly depreciation schedule:
- **Straight line**: monthly = (purchaseCost - residualValue) / usefulLifeMonths
- **Reducing balance**: monthly = currentBookValue * (annualRate / 12), where annualRate = 1 - (residualValue / purchaseCost)^(1/years)
- Returns: Array<{ month, openingValue, depreciation, closingValue }>

`runMonthlyDepreciation()` — for all active assets: calculate one month's depreciation, update currentBookValue and accumulatedDepreciation.

`disposeAsset(id, input)` — set status="disposed", disposedAt, disposalAmount. Calculate gain/loss = disposalAmount - currentBookValue.

**Tests:** createAsset (ref, initial bookValue), calculateDepreciation straight_line (correct monthly amount, reaches residual), calculateDepreciation reducing_balance, disposeAsset (gain/loss calculation).

Commit: `feat(finance): add fixed asset management with depreciation calculations`

---

## Task 4: Currency Actions

Create `apps/web/lib/actions/currency.ts` and tests.

**Functions:**

`fetchExchangeRates()` — fetch ECB daily rates (https://www.ecb.europa.eu/stats/eurofints/rss/fxref-daily.xml or the simpler CSV endpoint). Parse rates, store in ExchangeRate table. If fetch fails, log error and continue (don't break the app).

For MVP, use a simpler approach: hardcode a few common rates as fallback, allow manual override.

`getExchangeRate(from: string, to: string)` — look up latest rate from ExchangeRate table. If not found, return 1 (same currency) or throw.

`convertAmount(amount: number, fromCurrency: string, toCurrency: string, rate?: number)` — pure function. Returns { convertedAmount, rateUsed }.

`calculateFxGainLoss(invoiceAmount: number, invoiceRate: number, paymentAmount: number, paymentRate: number)` — pure function for realized FX gain/loss. Returns gain/loss amount.

`getOrgSettings()` — return or create default OrgSettings.

`updateBaseCurrency(currency: string)` — update OrgSettings.baseCurrency.

**Tests:** convertAmount (GBP to USD, same currency = passthrough), calculateFxGainLoss (positive gain, negative loss, zero when same rate), getExchangeRate (returns stored rate).

Commit: `feat(finance): add multi-currency exchange rate and FX gain/loss calculations`

---

## Task 5: API Routes

Create:
- `apps/web/app/api/v1/finance/assets/route.ts` — GET list + POST create
- `apps/web/app/api/v1/finance/assets/[id]/route.ts` — GET detail + PATCH (dispose)
- `apps/web/app/api/v1/finance/exchange-rates/route.ts` — GET current rates + POST trigger fetch

Commit: `feat(finance): add asset and exchange rate API endpoints`

---

## Task 6: Asset Register UI Pages

**`apps/web/app/(shell)/finance/assets/page.tsx`** — list: assetId (mono), name, category badge, purchase cost, current book value, status, depreciation %. "New Asset" button.

**`apps/web/app/(shell)/finance/assets/new/page.tsx`** + **`apps/web/components/finance/CreateAssetForm.tsx`** — form: name, category dropdown, purchase date, cost, currency, depreciation method (straight line/reducing balance), useful life (months), residual value, location, serial number.

**`apps/web/app/(shell)/finance/assets/[id]/page.tsx`** — detail: metadata grid, depreciation schedule table (month, opening value, depreciation, closing value), progress bar showing % depreciated, "Dispose Asset" button with disposal amount input.

Commit: `feat(finance): add asset register pages with depreciation schedule`

---

## Task 7: Currency Settings Page

**`apps/web/app/(shell)/finance/settings/currency/page.tsx`** —
- Base currency selector (GBP/USD/EUR)
- Auto-fetch rates toggle
- Current exchange rates table (base → target, rate, last fetched)
- "Fetch Latest Rates" button
- Manual rate override input per currency pair

Commit: `feat(finance): add currency settings page`

---

## Task 8: Dashboard Update + Verification

Update dashboard:
- "Total Asset Value" widget: sum of currentBookValue from active assets
- "Currency" indicator: show base currency
- Navigation: add Assets and Currency Settings links

Run all tests.

Commit: `feat(finance): add assets and currency to finance dashboard`

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Prisma models: FixedAsset, ExchangeRate, OrgSettings |
| 2 | Validation schemas |
| 3 | Asset management with straight-line and reducing-balance depreciation |
| 4 | Multi-currency with exchange rates and FX gain/loss |
| 5 | API endpoints |
| 6 | Asset register UI with depreciation schedule |
| 7 | Currency settings page |
| 8 | Dashboard update + verification |
