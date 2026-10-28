---
title: Exact owned-review OAuth diagnosis
date: 2026-10-28
backlog:
  - BI-CAP-29F5787B
---

# Exact owned-review OAuth diagnosis

Design: [owned review authority diagnostics](../specs/2026-10-26-owned-review-authority-diagnostics.md), October 28 amendment.

One atomic deliverable under BI-CAP-29F5787B: refine the existing shared OAuth
execution predicate and project safe fixed refusal details through existing
owner-admitted review reads. Predicate and projection are one behavior and one
revert; neither is separately shippable. Existing transport and executor
reconciliation work remain separately owned.

1. Reproduce ambiguous refusal with source tests for missing/revoked client,
   unavailable continuity, consent mismatch and unavailable storage. Check exact
   fixed detail and unchanged execution denial, rather than token identifiers.
2. Extract inspection from the existing OAuth boolean predicate; retain boolean
   wrapper, query/short-circuit semantics and thrown storage errors. Add optional
   safe detail to the current review authority observation and fixed guidance.
3. Verify valid access and refresh/successor continuity, credentials-client
   compatibility, all refusal branches, foreign-owner isolation, no raw fields,
   no mutation and unchanged retry/settlement. Run affected tests and typechecks.
4. Use normal exact-head publication gate, independent review, signed PR and
   protected merge. Verify canonical deployment before original-owner read.
5. Record actual current 5C843 refusal detail or observation failure. No new
   provider test, health receipt or retry follows solely from diagnostic success.

Requirement mapping: OBJ-CAP29-AUTH; AC-CAP29-1 through AC-CAP29-5.
Contract: existing OAuth execution authority and owned semantic-review recovery.
Flow: original-owner task read → existing shared verifier → fixed safe detail.
Verification: predicate parity tests, recovery projection tests, canonical owner
read. Local source checks are not live acceptance.
