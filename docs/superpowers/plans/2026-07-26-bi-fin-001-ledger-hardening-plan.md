# General Ledger Hardening & Invariants Plan (BI-FIN-001)

## Goal
Harden the DPF General Ledger layer to production-grade accounting invariants:
- Immutable posted entries.
- Storno / reversal posting lines generator (`buildReversalPostingLines`) that guarantees balanced reversal entries.
- Journal entry reversal service method (`reverseJournalEntry`) enforcing period lock rules.
- Period lock validation functions (`isPeriodLocked`, `validatePostingPeriod`).
- Comprehensive unit tests covering accounting rules and period-lock enforcement.

## Implementation
- `apps/web/lib/finance/ledger.ts`: Pure invariant functions.
- `apps/web/lib/finance/ledger-service.ts`: DB persistence and journal entry reversal.
- `apps/web/lib/finance/ledger.test.ts`: Vitest suite covering all ledger invariants.
