---
status: active
---

# Backlog triage efficiency implementation

Backlog: BI-E3FBB0C4. Workroom: WC-C9D2BC8A. Shape: delivery-medium@1.0.0.
Design: docs/superpowers/specs/2026-10-04-backlog-triage-efficiency-design.md.

Delivery preflight also requires the new disclosure label to use the admin message catalog and provider, explicit active status frontmatter, and normalization of Windows glob fixture paths in the instruction-coverage test to match its existing production reader. These bounded verification repairs accompany this delivery; they add no triage behavior or authorization.

## Acceptance

- AC-1: An unchanged item already assessed as needing review receives no further scheduled model request; relevant input or policy changes make it eligible again.
- AC-2: Held older items do not prevent later eligible triaging items from being assessed.
- AC-3: Model failures, invalid responses, low confidence, review decisions, ledger failures and apply failures have distinct durable outcomes with bounded retry rules.
- AC-4: Each run has a bounded request/time budget and cannot overwrite a concurrent manual triage decision.
- AC-5: Existing scheduled-work reporting presents meaningful run counts and errors, including zero-progress and skipped work, rather than a misleading blanket ok.
- AC-6: Regression tests verify repeat suppression, change invalidation, queue fairness, retries, concurrent updates and safety gates.

## Atomic delivery

The operator authorized fixing the core triage feature from these findings. Selection, assessment persistence, retry behavior and truthful reporting are one behavior contract: shipping suppression without durable outcomes hides failures; shipping outcomes without eligible selection retains the model waste. Phases below are internal sequencing and deliver BI-E3FBB0C4 in one reversible PR. Approximately 20% of implementation effort is refactoring the existing outcome and reporting paths.

## Phases and traceability

1. Refactor core assessment into typed outcomes and add fingerprint/retry helpers. Contract: apps/web/lib/operate/backlog-triage-drain.ts. Flow: scheduled-triage-assess. Verification: backlog-triage-drain.test.ts and assessment regression tests. Requirements: AC-1, AC-3, AC-4, AC-6.
2. Wire typed BacklogItem assessment projection, additive enum/columns migration and bounded activity audit selection and conditional updates into apps/web/lib/queue/functions/backlog-triage-drain.ts. Flow: scheduled-triage-select-apply. Verification: wrapper/repository tests exercising unchanged prefix, later eligible items and concurrent edits. Requirements: AC-1, AC-2, AC-3, AC-4, AC-6.
3. Update existing ScheduledJob result projection and Scheduled Jobs reporting using existing theme-aware components. Contract: apps/web/lib/operate/discovery-scheduler.ts and apps/web/lib/operate/scheduled-jobs/work-model.ts. Flow: scheduled-triage-report. Verification: scheduled work model tests plus served-target UX exercise. Requirements: AC-5, AC-6.
4. Run affected unit tests, web typecheck, scope guards, documentation lint, shared local-CI gate, independent review and functional two-sweep verification. Flow: scheduled-triage-verify. Verification: canonical runtime or governed local-CI, not a worktree server. Consume resolved changeImpactContract; unresolved advice expands verification. Update operator documentation and UX-fit evidence in the same PR.

## Risk and rollback

Malformed/stale assessments must not suppress changed work. Failed assessment persistence must not masquerade as completion. Conditional mutations preserve manual changes and federation ownership. Revert the scoped PR to restore prior selection while retaining activity history; leave additive columns in place during rollback.

## Backlog coverage

Atomic deliverable: triage-efficiency; BI-E3FBB0C4. Requirement refs: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6. Contract ref: apps/web/lib/operate/backlog-triage-drain.ts. Flow ref: scheduled-triage-assess. Verification ref: backlog-triage-drain.test.ts. Immutable coverage receipt is recorded before source implementation.
