# Financial Management Phase H: Archetype-Driven Financial Setup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map each storefront archetype to a financial profile that seeds chart of accounts templates, tax configuration defaults, payment terms, invoice template style, expense categories, and dunning defaults. Extend the first-run setup wizard with a 3-question financial configuration step (Decision 5.1). Provide progressive disclosure so new businesses get a working financial setup with zero accounting knowledge.

**Architecture:** Financial profiles stored as a TypeScript template catalog in `packages/finance-templates`. Applied during first-run setup wizard. No new Prisma models needed — profiles write to existing OrgSettings, DunningSequence, and seed reference data. The setup wizard extension is a new step in the existing storefront setup flow.

**Tech Stack:** TypeScript template catalog, existing Prisma models, existing setup wizard infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (items 19-20)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 5.1-5.3, Section 10 archetype defaults)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/finance-templates/src/index.ts` | Export all templates |
| `packages/finance-templates/src/types.ts` | FinancialProfile type definition |
| `packages/finance-templates/src/profiles.ts` | 10 archetype financial profiles |
| `packages/finance-templates/src/profiles.test.ts` | Validation tests |
| `packages/finance-templates/package.json` | Package config |
| `packages/finance-templates/tsconfig.json` | TypeScript config |
| `apps/web/lib/actions/financial-setup.ts` | Apply financial profile to org |
| `apps/web/lib/actions/financial-setup.test.ts` | Tests |
| `apps/web/app/(shell)/finance/settings/page.tsx` | Financial settings overview |
| `apps/web/components/storefront-admin/FinancialSetupStep.tsx` | Setup wizard financial step |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/components/storefront-admin/SetupWizard.tsx` | Add financial setup step |
| `apps/web/app/(shell)/finance/page.tsx` | Show setup prompt if no financial profile applied |

---

## Task 1: Finance Templates Package

Create `packages/finance-templates/` with the financial profile catalog.

**`packages/finance-templates/package.json`:**
```json
{
  "name": "@dpf/finance-templates",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

**`packages/finance-templates/tsconfig.json`:**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**`packages/finance-templates/src/types.ts`:**
```typescript
export type FinancialProfile = {
  archetypeCategory: string;
  displayName: string;
  defaultPaymentTerms: string;
  defaultCurrency: string;
  vatRegistered: boolean;
  defaultTaxRate: number;
  dunningEnabled: boolean;
  dunningStyle: "standard" | "aggressive" | "gentle" | "off";
  recurringBillingEnabled: boolean;
  invoiceTemplateStyle: "professional" | "trade" | "creative" | "nonprofit" | "minimal";
  expenseCategories: string[];
  purchaseOrdersEnabled: boolean;
  chartOfAccountsSeed: Array<{
    code: string;
    name: string;
    type: "revenue" | "expense" | "asset" | "liability" | "equity";
  }>;
};
```

**`packages/finance-templates/src/profiles.ts`:**

10 profiles matching the spec's archetype table (Section 10 of implementation decisions):

```typescript
export const FINANCIAL_PROFILES: Record<string, FinancialProfile> = {
  "healthcare_wellness": {
    archetypeCategory: "Healthcare/Wellness",
    displayName: "Healthcare & Wellness",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 0, // most healthcare is VAT exempt
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true, // memberships
    invoiceTemplateStyle: "professional",
    expenseCategories: ["travel", "meals", "supplies", "equipment", "insurance", "training"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Clinical Revenue", type: "revenue" },
      { code: "4100", name: "Membership Revenue", type: "revenue" },
      { code: "5000", name: "Clinical Supplies", type: "expense" },
      { code: "5100", name: "Staff Costs", type: "expense" },
      { code: "6000", name: "Rent & Utilities", type: "expense" },
      { code: "6100", name: "Insurance", type: "expense" },
    ],
  },
  "trades_construction": {
    archetypeCategory: "Trades/Construction",
    displayName: "Trades & Construction",
    defaultPaymentTerms: "Net 14",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "aggressive",
    recurringBillingEnabled: true, // maintenance contracts
    invoiceTemplateStyle: "trade",
    expenseCategories: ["travel", "fuel", "materials", "tools", "vehicle", "subcontractor", "insurance"],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Job Revenue", type: "revenue" },
      { code: "4100", name: "Maintenance Contracts", type: "revenue" },
      { code: "5000", name: "Materials", type: "expense" },
      { code: "5100", name: "Subcontractor Costs", type: "expense" },
      { code: "5200", name: "Tool & Equipment", type: "expense" },
      { code: "6000", name: "Vehicle Costs", type: "expense" },
      { code: "6100", name: "Insurance", type: "expense" },
    ],
  },
  "professional_services": {
    archetypeCategory: "Professional Services",
    displayName: "Professional Services",
    defaultPaymentTerms: "Net 30",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true, // retainers
    invoiceTemplateStyle: "professional",
    expenseCategories: ["travel", "meals", "accommodation", "software", "training", "office"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Consulting Revenue", type: "revenue" },
      { code: "4100", name: "Retainer Revenue", type: "revenue" },
      { code: "5000", name: "Staff Costs", type: "expense" },
      { code: "6000", name: "Office & Admin", type: "expense" },
      { code: "6100", name: "Software & Subscriptions", type: "expense" },
      { code: "6200", name: "Professional Development", type: "expense" },
    ],
  },
  "retail": {
    archetypeCategory: "Retail",
    displayName: "Retail",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "gentle",
    recurringBillingEnabled: false,
    invoiceTemplateStyle: "minimal",
    expenseCategories: ["supplies", "packaging", "shipping", "marketing", "rent", "utilities"],
    purchaseOrdersEnabled: true, // supplier orders
    chartOfAccountsSeed: [
      { code: "4000", name: "Product Sales", type: "revenue" },
      { code: "5000", name: "Cost of Goods Sold", type: "expense" },
      { code: "5100", name: "Shipping & Packaging", type: "expense" },
      { code: "6000", name: "Rent & Utilities", type: "expense" },
      { code: "6100", name: "Marketing", type: "expense" },
    ],
  },
  "education_training": {
    archetypeCategory: "Education/Training",
    displayName: "Education & Training",
    defaultPaymentTerms: "50% deposit",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 0, // education often VAT exempt
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true, // course subscriptions
    invoiceTemplateStyle: "professional",
    expenseCategories: ["travel", "materials", "venue", "software", "marketing", "equipment"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Course Revenue", type: "revenue" },
      { code: "4100", name: "Subscription Revenue", type: "revenue" },
      { code: "5000", name: "Course Materials", type: "expense" },
      { code: "5100", name: "Venue Hire", type: "expense" },
      { code: "6000", name: "Marketing", type: "expense" },
    ],
  },
  "nonprofit": {
    archetypeCategory: "Nonprofit",
    displayName: "Nonprofit & Charity",
    defaultPaymentTerms: "Donation receipt",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: false, // no chasing donors
    dunningStyle: "off",
    recurringBillingEnabled: true, // recurring giving
    invoiceTemplateStyle: "nonprofit",
    expenseCategories: ["programme", "fundraising", "admin", "travel", "events", "grants"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Donations", type: "revenue" },
      { code: "4100", name: "Grants", type: "revenue" },
      { code: "4200", name: "Fundraising Events", type: "revenue" },
      { code: "5000", name: "Programme Costs", type: "expense" },
      { code: "5100", name: "Fundraising Costs", type: "expense" },
      { code: "6000", name: "Admin & Overheads", type: "expense" },
    ],
  },
  "food_hospitality": {
    archetypeCategory: "Food/Hospitality",
    displayName: "Food & Hospitality",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: false,
    dunningStyle: "off",
    recurringBillingEnabled: false,
    invoiceTemplateStyle: "minimal",
    expenseCategories: ["ingredients", "supplies", "staff", "rent", "utilities", "equipment", "licensing"],
    purchaseOrdersEnabled: true, // supplier orders
    chartOfAccountsSeed: [
      { code: "4000", name: "Food & Beverage Sales", type: "revenue" },
      { code: "5000", name: "Cost of Ingredients", type: "expense" },
      { code: "5100", name: "Staff Costs", type: "expense" },
      { code: "6000", name: "Rent & Utilities", type: "expense" },
      { code: "6100", name: "Licensing & Compliance", type: "expense" },
    ],
  },
  "fitness_recreation": {
    archetypeCategory: "Fitness/Recreation",
    displayName: "Fitness & Recreation",
    defaultPaymentTerms: "Monthly DD",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true, // memberships
    invoiceTemplateStyle: "minimal",
    expenseCategories: ["equipment", "rent", "utilities", "staff", "marketing", "insurance", "maintenance"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Membership Revenue", type: "revenue" },
      { code: "4100", name: "Class & Session Revenue", type: "revenue" },
      { code: "5000", name: "Staff Costs", type: "expense" },
      { code: "6000", name: "Facility Costs", type: "expense" },
      { code: "6100", name: "Equipment", type: "expense" },
    ],
  },
  "beauty_personal": {
    archetypeCategory: "Beauty/Personal",
    displayName: "Beauty & Personal Services",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "gentle",
    recurringBillingEnabled: true, // package deals
    invoiceTemplateStyle: "creative",
    expenseCategories: ["products", "supplies", "rent", "utilities", "training", "marketing", "insurance"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Service Revenue", type: "revenue" },
      { code: "4100", name: "Product Sales", type: "revenue" },
      { code: "5000", name: "Product Costs", type: "expense" },
      { code: "6000", name: "Salon/Studio Costs", type: "expense" },
      { code: "6100", name: "Marketing", type: "expense" },
    ],
  },
  "pet_services": {
    archetypeCategory: "Pet Services",
    displayName: "Pet Services",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true, // pet plans
    invoiceTemplateStyle: "minimal",
    expenseCategories: ["supplies", "food", "equipment", "vehicle", "insurance", "training", "rent"],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Service Revenue", type: "revenue" },
      { code: "4100", name: "Pet Plan Revenue", type: "revenue" },
      { code: "5000", name: "Supplies & Food", type: "expense" },
      { code: "6000", name: "Facility Costs", type: "expense" },
      { code: "6100", name: "Vehicle & Transport", type: "expense" },
    ],
  },
};

export function getFinancialProfile(archetypeSlug: string): FinancialProfile | null {
  return FINANCIAL_PROFILES[archetypeSlug] ?? null;
}

export function getAllProfiles(): Array<{ slug: string } & FinancialProfile> {
  return Object.entries(FINANCIAL_PROFILES).map(([slug, profile]) => ({ slug, ...profile }));
}
```

**Tests:** All 10 profiles have required fields, getFinancialProfile returns correct profile, returns null for unknown, all profiles have non-empty chartOfAccountsSeed.

Commit: `feat(finance): add financial profile templates for 10 business archetypes`

---

## Task 2: Financial Setup Actions

Create `apps/web/lib/actions/financial-setup.ts` and tests.

**Functions:**

`applyFinancialProfile(profileSlug: string)` — the core setup function:
1. Load profile from `@dpf/finance-templates`
2. Update or create OrgSettings with baseCurrency, autoFetchRates
3. Seed default dunning sequence matching the profile's dunningStyle (or skip if dunningEnabled=false)
4. Store payment terms default somewhere accessible (OrgSettings or a config key)
5. Return { applied: true, profile: displayName }

`getFinancialSetupStatus()` — check if a financial profile has been applied (does OrgSettings exist with non-default values, does DunningSequence exist).

`resetFinancialProfile()` — for re-running setup. Clears and re-applies.

**Tests:** applyFinancialProfile creates OrgSettings and DunningSequence, getFinancialSetupStatus returns correct state, applying nonprofit profile skips dunning.

Commit: `feat(finance): add financial profile application actions`

---

## Task 3: Setup Wizard Financial Step

**`apps/web/components/storefront-admin/FinancialSetupStep.tsx`** — client component.

Per Decision 5.1, exactly 3 questions:
1. **Business type** — already answered (passed as prop from archetype selection). Show as confirmation: "Your business type: {archetype}. We'll configure your finances to match."
2. **VAT registered?** — Yes/No toggle. Defaults from profile.
3. **Base currency** — GBP/USD selector. Defaults from profile.

"Set Up Finances" button → calls `applyFinancialProfile(archetypeSlug)` with overrides for VAT and currency.

Success state: "Your finances are set up. You can customise later in Finance Settings." with link to `/finance/settings`.

Do NOT show chart of accounts. Do NOT show payment terms. Do NOT show dunning config. These are all auto-configured from the profile (Decision 5.1: don't show COA during setup — terrifying to non-accountants).

**Modify `apps/web/components/storefront-admin/SetupWizard.tsx`:**

Read the existing wizard. Add a new step after the archetype/storefront setup. The financial step should be the last step before completion. Pass the selected archetype slug as a prop.

Commit: `feat(finance): add financial setup step to storefront wizard`

---

## Task 4: Financial Settings Page

**`apps/web/app/(shell)/finance/settings/page.tsx`** — server component.

Breadcrumb: Finance / Settings

Overview of all financial configuration:
- **Applied Profile**: show which archetype profile is applied (or "Not configured")
- **Base Currency**: current value, link to currency settings
- **Payment Terms Default**: current value
- **VAT Status**: registered/not
- **Dunning**: enabled/disabled, link to dunning settings
- **Recurring Billing**: enabled/disabled
- **Purchase Orders**: enabled/disabled
- **Invoice Template**: current style

Each item is a card with current value and "Change" link to the relevant settings page.

"Re-run Financial Setup" button → resets and re-applies profile.

Commit: `feat(finance): add financial settings overview page`

---

## Task 5: Dashboard Setup Prompt + Navigation

Modify `apps/web/app/(shell)/finance/page.tsx`:
- If no financial profile has been applied (check via getFinancialSetupStatus), show a banner at top: "Complete your financial setup to get started" with link to setup wizard or `/finance/settings`
- Add "Settings" to navigation with link to `/finance/settings`

Run all tests. Final verification.

Commit: `feat(finance): add setup prompt to finance dashboard`

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | 10 archetype financial profiles with COA, tax, terms, dunning, expense categories |
| 2 | Profile application actions (setup, status check, reset) |
| 3 | 3-question financial setup wizard step |
| 4 | Financial settings overview page |
| 5 | Dashboard setup prompt + final navigation |
