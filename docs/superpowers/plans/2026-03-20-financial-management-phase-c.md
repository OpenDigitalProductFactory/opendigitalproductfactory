# Financial Management Phase C: Banking & Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver bank account management, CSV statement import, a code-as-you-go reconciliation engine with bank rules and AI-assisted matching, and a real cash position dashboard replacing the current placeholder.

**Architecture:** New Prisma models (BankAccount, BankTransaction, BankRule) extend the finance schema. Server actions in `lib/actions/banking.ts`. CSV parsing with format auto-detection. Matching engine suggests matches by amount/date/reference with confidence scoring. Bank rules auto-apply account codes on import. Cash position dashboard calculates live balance + 30/60/90-day forecast from receivables and payables.

**Tech Stack:** Prisma (PostgreSQL), Next.js App Router, Vitest, papaparse (CSV parsing), existing auth/permissions/finance infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (items 9-11)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 3.1-3.4, 4.1)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/banking.ts` | Server actions: bank account CRUD, CSV import, matching, reconciliation, bank rules |
| `apps/web/lib/actions/banking.test.ts` | Unit tests |
| `apps/web/lib/banking-validation.ts` | Zod schemas |
| `apps/web/lib/banking-validation.test.ts` | Validation tests |
| `apps/web/lib/csv-parser.ts` | CSV parsing with bank format auto-detection |
| `apps/web/lib/csv-parser.test.ts` | CSV parser tests |
| `apps/web/lib/matching-engine.ts` | Transaction-to-payment matching with confidence scoring |
| `apps/web/lib/matching-engine.test.ts` | Matching engine tests |
| `apps/web/app/(shell)/finance/banking/page.tsx` | Bank account list + transaction feed |
| `apps/web/app/(shell)/finance/banking/[id]/page.tsx` | Bank account detail + transaction feed |
| `apps/web/app/(shell)/finance/banking/[id]/reconcile/page.tsx` | Reconciliation UI |
| `apps/web/app/(shell)/finance/banking/[id]/import/page.tsx` | CSV import page |
| `apps/web/app/(shell)/finance/banking/rules/page.tsx` | Bank rules management |
| `apps/web/components/finance/ImportCSVForm.tsx` | Client component for CSV upload + preview |
| `apps/web/components/finance/ReconciliationFeed.tsx` | Client component for code-as-you-go reconciliation |
| `apps/web/app/api/v1/finance/bank-accounts/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/bank-accounts/[id]/route.ts` | GET detail |
| `apps/web/app/api/v1/finance/bank-accounts/[id]/transactions/route.ts` | GET transactions + POST import |
| `apps/web/app/api/v1/finance/bank-accounts/[id]/reconcile/route.ts` | POST match/unmatch |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add BankAccount, BankTransaction, BankRule models |
| `apps/web/app/(shell)/finance/page.tsx` | Replace placeholder cash position with real data from BankAccount |

---

## Task 1: BankAccount, BankTransaction, and BankRule Prisma Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add models**

```prisma
// ─── Finance: Banking & Reconciliation ─────────────────────────────

model BankAccount {
  id              String              @id @default(cuid())
  bankAccountId   String              @unique
  name            String
  bankName        String?
  accountNumber   String?
  sortCode        String?
  iban            String?
  swift           String?
  currency        String              @default("GBP")
  accountType     String              @default("current")
  isDefault       Boolean             @default(false)
  openingBalance  Decimal             @default(0)
  currentBalance  Decimal             @default(0)
  lastReconciledAt DateTime?
  status          String              @default("active")
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  transactions    BankTransaction[]

  @@index([status])
}

model BankTransaction {
  id               String            @id @default(cuid())
  bankAccountId    String
  transactionDate  DateTime
  description      String
  amount           Decimal
  balance          Decimal?
  reference        String?
  category         String?
  matchStatus      String            @default("unmatched")
  matchedPaymentId String?
  importBatchId    String?
  createdAt        DateTime          @default(now())

  bankAccount      BankAccount       @relation(fields: [bankAccountId], references: [id])

  @@index([bankAccountId])
  @@index([matchStatus])
  @@index([transactionDate])
  @@index([importBatchId])
}

model BankRule {
  id              String              @id @default(cuid())
  name            String
  matchField      String
  matchType       String              @default("contains")
  matchValue      String
  accountCode     String?
  category        String?
  taxRate         Decimal?
  description     String?
  isActive        Boolean             @default(true)
  hitCount        Int                 @default(0)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}
```

- [ ] **Step 2: Generate and run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_banking_models`
Consent granted for dev database reset if needed.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(finance): add BankAccount, BankTransaction, BankRule models"
```

---

## Task 2: Banking Validation Schemas

**Files:**
- Create: `apps/web/lib/banking-validation.ts`
- Create: `apps/web/lib/banking-validation.test.ts`

- [ ] **Step 1: Write tests then implement**

Schemas needed:
- `createBankAccountSchema`: name (required), bankName, accountNumber, sortCode, iban, swift, currency (3 chars, default GBP), accountType (current|savings|credit_card|loan|merchant), openingBalance (number, default 0)
- `importTransactionsSchema`: bankAccountId (required), transactions array of { date, description, amount, reference?, balance? }
- `matchTransactionSchema`: transactionId (required), paymentId (required)
- `createBankRuleSchema`: name (required), matchField (payee|description|reference), matchType (contains|exact|starts_with), matchValue (required), accountCode?, category?, taxRate?, description?

Tests: valid inputs accepted, missing required fields rejected, invalid accountType rejected, empty transactions array rejected.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add Zod validation schemas for banking"
```

---

## Task 3: CSV Parser with Format Auto-Detection

**Files:**
- Create: `apps/web/lib/csv-parser.ts`
- Create: `apps/web/lib/csv-parser.test.ts`

- [ ] **Step 1: Install papaparse**

Run: `cd apps/web && pnpm add papaparse && pnpm add -D @types/papaparse`

- [ ] **Step 2: Write tests**

```typescript
describe("parseCSV", () => {
  it("parses standard date/description/amount CSV", () => { ... });
  it("auto-detects debit/credit columns vs signed amount", () => { ... });
  it("handles UK date format (DD/MM/YYYY)", () => { ... });
  it("handles US date format (MM/DD/YYYY)", () => { ... });
  it("handles ISO date format", () => { ... });
  it("skips blank rows without failing", () => { ... });
  it("reports bad rows without failing entire import", () => { ... });
  it("returns parsed transactions and error count", () => { ... });
});

describe("detectBankFormat", () => {
  it("detects Barclays format", () => { ... });
  it("detects Lloyds format", () => { ... });
  it("detects generic format", () => { ... });
});
```

- [ ] **Step 3: Implement**

```typescript
export type ParsedTransaction = {
  date: Date;
  description: string;
  amount: number; // positive = credit, negative = debit
  balance?: number;
  reference?: string;
};

export type ParseResult = {
  transactions: ParsedTransaction[];
  errors: Array<{ row: number; message: string }>;
  format: string;
};

export function parseCSV(csvContent: string): ParseResult {
  // 1. Parse with papaparse
  // 2. Detect format from headers (Barclays: Date,Description,Money In,Money Out,Balance; Lloyds: Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance; Generic: Date,Description,Amount)
  // 3. Map columns to ParsedTransaction
  // 4. Auto-detect date format (try DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)
  // 5. Handle debit/credit columns (two columns) or signed amount (one column)
  // 6. Skip blank rows, report bad rows
  // 7. Return { transactions, errors, format }
}
```

CRITICAL: One bad row must NOT fail the entire import (Decision 3.4).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add CSV parser with bank format auto-detection"
```

---

## Task 4: Matching Engine

**Files:**
- Create: `apps/web/lib/matching-engine.ts`
- Create: `apps/web/lib/matching-engine.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe("findMatches", () => {
  it("matches exact amount + close date (high confidence)", () => { ... });
  it("matches by reference string", () => { ... });
  it("matches by payee name in description", () => { ... });
  it("returns confidence score 0-100", () => { ... });
  it("returns multiple candidates sorted by confidence", () => { ... });
  it("returns empty array when no match found", () => { ... });
});

describe("applyBankRules", () => {
  it("applies matching rule to categorize transaction", () => { ... });
  it("increments rule hit count", () => { ... });
  it("skips inactive rules", () => { ... });
});
```

- [ ] **Step 2: Implement**

```typescript
export type MatchCandidate = {
  paymentId: string;
  paymentRef: string;
  amount: number;
  date: Date;
  counterparty: string;
  confidence: number; // 0-100
  matchReasons: string[];
};

export function findMatches(
  transaction: { amount: number; date: Date; description: string; reference?: string },
  payments: Array<{ id: string; paymentRef: string; amount: number; receivedAt: Date | null; counterpartyId: string | null; reference: string | null }>,
): MatchCandidate[] {
  // Score each payment:
  // +40 for exact amount match
  // +30 for amount within 1% (rounding differences)
  // +25 for date within 3 days
  // +15 for date within 7 days
  // +20 for reference match (contains)
  // +15 for payee name in description
  // Return candidates with confidence > 30, sorted desc
}

export function applyBankRules(
  transaction: { description: string; reference?: string; amount: number },
  rules: Array<{ matchField: string; matchType: string; matchValue: string; accountCode?: string; category?: string; taxRate?: number; description?: string; isActive: boolean }>,
): { accountCode?: string; category?: string; taxRate?: number; description?: string } | null {
  // Find first matching active rule
  // Match field: payee checks description, reference checks reference, description checks description
  // Match type: contains, exact, starts_with
  // Return matched rule's auto-fill values, or null
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(finance): add transaction matching engine with confidence scoring"
```

---

## Task 5: Banking Server Actions

**Files:**
- Create: `apps/web/lib/actions/banking.ts`
- Create: `apps/web/lib/actions/banking.test.ts`

- [ ] **Step 1: Write tests then implement**

**Functions:**
- `createBankAccount(input)` — generates BA-{nanoid(8)}, sets currentBalance = openingBalance
- `getBankAccount(id)` — with recent transactions (last 50), unmatched count
- `listBankAccounts()` — all accounts with currentBalance summary
- `importTransactions(bankAccountId, csvContent)` — parse CSV, apply bank rules, create BankTransaction records, generate importBatchId, update BankAccount.currentBalance, return { imported, errors }
- `getTransactions(bankAccountId, filters?)` — paginated, filter by matchStatus/dateRange
- `matchTransaction(transactionId, paymentId)` — link transaction to payment, mark as "matched", update Payment.reconciled=true
- `unmatchTransaction(transactionId)` — unlink, mark "unmatched", update Payment.reconciled=false
- `suggestMatches(transactionId)` — load transaction, load unreconciled payments, run matching engine, return candidates
- `createBankRule(input)` — create rule
- `listBankRules()` — all rules ordered by hitCount desc
- `getReconciliationSummary(bankAccountId)` — unmatched count, last reconciled date, reconciled balance vs bank balance

**Tests:** createBankAccount (auth, ref), importTransactions (parses CSV, creates records, handles errors), matchTransaction (links payment, marks reconciled), suggestMatches (returns candidates).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add banking server actions for accounts, import, matching, and reconciliation"
```

---

## Task 6: Banking API Routes

**Files:**
- Create 4 route files under `apps/web/app/api/v1/finance/bank-accounts/`

- [ ] **Step 1: Create routes**

- `route.ts` — GET list + POST create
- `[id]/route.ts` — GET detail
- `[id]/transactions/route.ts` — GET paginated transactions + POST import (accepts CSV in request body or as file upload)
- `[id]/reconcile/route.ts` — POST match/unmatch

All follow existing patterns (`.js` imports, `authenticateRequest`, error handling).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add banking API endpoints"
```

---

## Task 7: Banking List and Account Detail Pages

**Files:**
- Create: `apps/web/app/(shell)/finance/banking/page.tsx`
- Create: `apps/web/app/(shell)/finance/banking/[id]/page.tsx`

- [ ] **Step 1: Banking list page**

Shows all bank accounts as cards: name, bank name, account number (masked: ****1234), currency, current balance (large), last reconciled date, unmatched transaction count. "Add Bank Account" button. Links to account detail.

- [ ] **Step 2: Account detail page**

Transaction feed (code-as-you-go view): recent transactions listed chronologically. Each shows: date, description, amount (green for credits, red for debits), match status badge. Unmatched transactions have a "Match" button. Actions: "Import Statement" link, "Reconcile" link, "Bank Rules" link.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(finance): add banking list and account detail pages"
```

---

## Task 8: CSV Import Page

**Files:**
- Create: `apps/web/app/(shell)/finance/banking/[id]/import/page.tsx`
- Create: `apps/web/components/finance/ImportCSVForm.tsx`

- [ ] **Step 1: Import page**

Server component wrapper fetching bank account name. Client component `ImportCSVForm`:
- File upload input (accepts .csv)
- On file select: parse client-side preview (first 5 rows)
- Show detected format, row count, date range
- Show any error rows with row number and message
- "Import" button calls server action
- Success: show imported count, error count, redirect to account detail

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add CSV import page with format preview"
```

---

## Task 9: Reconciliation Page

**Files:**
- Create: `apps/web/app/(shell)/finance/banking/[id]/reconcile/page.tsx`
- Create: `apps/web/components/finance/ReconciliationFeed.tsx`

- [ ] **Step 1: Reconciliation page**

Server component loads unmatched transactions and reconciliation summary. Client component `ReconciliationFeed`:

Code-as-you-go workflow (Decision 3.1):
- Each unmatched transaction shown as a card
- Green "OK" button if a high-confidence match exists (auto-suggested)
- Click "OK" → one-click confirm match
- Click "Match" → shows candidate list with confidence scores
- Click "Skip" → leave for later
- Running tally: X of Y transactions matched
- Bank rules: "Create Rule" button on each transaction → quick rule creation from this transaction's pattern

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add reconciliation page with code-as-you-go matching"
```

---

## Task 10: Bank Rules Page

**Files:**
- Create: `apps/web/app/(shell)/finance/banking/rules/page.tsx`

- [ ] **Step 1: Rules management page**

List all bank rules ordered by hit count (most used first). Each shows: name, match criteria (field/type/value), auto-fill values (category, account code), hit count, active toggle. "New Rule" form at top. Delete button per rule.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add bank rules management page"
```

---

## Task 11: Update Finance Dashboard with Real Cash Position

**Files:**
- Modify: `apps/web/app/(shell)/finance/page.tsx`

- [ ] **Step 1: Replace placeholder with real cash data**

Replace the current "Money Owed To You" widget approach with:

**Widget 1: Cash Position** — sum of `currentBalance` from all active BankAccounts. Show per-account breakdown if > 1 account. Trend arrow (compare to 7 days ago if transaction history exists).

**Widget 2: Cash Flow Forecast** — 30-day forward view: current cash + expected inflows (invoice amountDue with dueDate in next 30 days) - expected outflows (bill amountDue with dueDate in next 30 days). Show the number: "In 30 days you'll have approximately £X."

Keep existing widgets (Outstanding Invoices, Overdue, Money You Owe) and add:

**Quick links section:** Add Banking link to the navigation.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): update dashboard with real cash position and 30-day forecast"
```

---

## Task 12: Full Test Suite Verification

- [ ] **Step 1: Run all finance + AP + banking tests**
- [ ] **Step 2: Verify no regressions**
- [ ] **Step 3: Fix any issues**

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Prisma models: BankAccount, BankTransaction, BankRule |
| 2 | Zod validation schemas |
| 3 | CSV parser with UK/US bank format auto-detection |
| 4 | Matching engine with confidence scoring |
| 5 | Banking server actions (CRUD, import, match, reconcile, rules) |
| 6 | REST API endpoints |
| 7 | Bank account list and detail pages |
| 8 | CSV import page with preview and error reporting |
| 9 | Reconciliation page (code-as-you-go with suggested matches) |
| 10 | Bank rules management page |
| 11 | Real cash position dashboard with 30-day forecast |
| 12 | Full test suite verification |
