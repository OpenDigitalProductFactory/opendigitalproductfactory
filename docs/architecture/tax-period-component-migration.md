# Tax period component normalization — migration record

**Backlog item:** BI-947F8703 (items 3, 4, 5)
**Kernel decision:** DI-31F2D7D10E25 — composite 9.631, margin 3.581, autonomy eligible
**Migration:** `20260826054627_normalize_tax_period_components_and_deposit_schedule`
**Schema steward review:** required — this record is the artifact that review reads.

This is a migration data-safety record for work already implemented, not a plan
for future work. It exists because dropping a column needs a written argument a
schema steward can check.

## Why a field drop is proposed at all

`TaxObligationPeriod` carried `salesTaxAmount` and `inputTaxAmount`. Those two
columns were the only home for a per-family component total, and they are
sales-shaped. Payroll needs employee-withheld and employer-contribution totals
on the same period spine, because withheld money is the employee's, held in
trust, and merging it with the employer's own contribution hides that from
anyone reading the liability.

Adding two columns would make four, each family's pair dead weight on every
other family's rows, and the next tax family would make six. The kernel weighed
that against normalizing and against deriving totals from `TaxLiabilityEntry` on
read; normalizing won by a margin of 3.581, carried by Single Source of Truth,
Strongly-Typed String Enums and Principal Convergence.

Keeping the columns *and* adding component rows was rejected on the same
grounds: it creates two homes for one fact, which is the defect the change
exists to remove.

## What the migration does, in order

1. Creates `TaxPeriodComponentKind` and `TaxDepositCadence` enums.
2. Creates `TaxObligationPeriodComponent`, unique on `(periodId, componentKind)`
   so "the withheld total" can never be ambiguous.
3. **Backfills before dropping.** One `sales_output` row per existing period from
   `salesTaxAmount`, one `sales_input` row from `inputTaxAmount`.
4. Drops `salesTaxAmount` and `inputTaxAmount`.
5. Creates `TaxDepositSchedule`, empty.

## Data-safety argument for the drop

- **No period loses a figure.** Every value in both columns is written to a
  component row in the same transaction, before either column is dropped.
- **Recorded zeros are carried, not collapsed.** A stored `0` on an existing
  period is a stated fact — "nothing was charged" — unlike an absent row.
  Collapsing them would silently reinterpret history. New periods simply never
  write a zero row, so the distinction is only ever load-bearing for rows that
  already exist.
- **No bottom line moves.** `netTaxAmount` is untouched. A filed return's total
  is exactly what it was, which matters because a filed return must stay frozen
  even if a component is later corrected.
- **Reversible in principle.** The inverse is a single `UPDATE ... FROM` off the
  component rows. Nothing is lost that could not be put back.
- **Blast radius is three source files.** `tax-remittance-core.ts`,
  `lib/actions/tax-remittance.ts` and `TaxObligationPeriodsTable.tsx` were the
  only readers; all three are updated in the same PR.

## What review is being asked to approve

The two entries added to `INTENTIONAL_FIELD_REMOVALS` in
`packages/db/scripts/schema-regression-guard.mjs`:

```
"TaxObligationPeriod.salesTaxAmount",
"TaxObligationPeriod.inputTaxAmount",
```

They should be pruned once this migration has shipped fleet-wide.

## Deliberately out of scope

- **Item 6 — the 941, 940, W-2/W-3 and 1099-NEC generators.** These need cited
  form layouts, the same constraint that blocks the rates (BI-4EB27955).
- **Semiweekly deposit spans.** The federal rule keys the due date off which day
  of the week wages were paid and needs the authority's banking-day and holiday
  calendar. `depositPeriodFor` returns `null` for it rather than fabricating a
  span that would produce a confident wrong due date.
- **Seeded deposit schedules.** A cadence is a determination against a published
  threshold. Seeding one would fabricate the evidence a filing relies on.
