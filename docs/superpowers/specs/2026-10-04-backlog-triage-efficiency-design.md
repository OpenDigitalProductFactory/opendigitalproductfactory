# Backlog triage assesses changed work once

Backlog: BI-E3FBB0C4. Workroom: WC-C9D2BC8A.

## Problem and evidence

The canonical portal reported 25 considered, zero advanced, 25 left for review at 2026-10-04T17:28:51Z and 18:30:38Z. The oldest ten screenshot items remain triaging. The wrapper always selects the oldest 25; the core collapses failures and review into one result. An unchanged held prefix is repeatedly inferred and later work starves.

## Design grounding

Extend the scheduling-surface-review design (2026-06-21) and existing backlog triage implementation. Nullable typed fields on BacklogItem own fingerprint, disposition, attempts, retry time, assessment time and claim token; BacklogItemActivity remains bounded audit history. Activity retention (365 days) cannot own durable suppression. ScheduledJob gets a typed lastRunSummary and runCursor; optional metadata carries supplementary diagnostic counts. An additive migration extends these existing carriers, with a generated assessment-outcome enum. No new service, table, provider or dependency. Work status and assessment disposition remain separate: held work stays triaging and visible.

## Ordered fix

1. Refactor the item core into a typed assessment result distinguishing build, review, low confidence, invalid response, model error, ledger error, apply error and concurrent change. Keep the legacy entry point compatible where needed. Persist assessments independently of the governance ledger; the ledger still precedes every build mutation.
2. Fingerprint the exact decision inputs plus a versioned policy. Read the typed assessment projection for that fingerprint. Completed judgments are held until inputs/policy change; transient failures get bounded backoff and a finite retry count. Explicitly re-triaging an item invalidates the assessment through lifecycle activity newer than its assessment timestamp. Unrelated activity must not cause another inference. Claim tokens fence expired workers without locking across inference.
3. Select eligible candidates across the waiting queue rather than stopping at the first 25 held items. Use bounded, paged database reads and deterministic ordering. Use existing job flow controls and durable steps; before inference and before mutation, re-read status and inputs. Conditional update prevents overwriting manual triage.
4. Bound model starts per run and elapsed model time. Store small structured outcomes and error classifications, never prompt bodies or provider exception text. Infrastructure/recording failure stops unsafe work and is reported.
5. Project the latest counts and reason in the existing Scheduled Jobs result area. Preserve enablement, cadence and kill switch. Show review needed separately from infrastructure errors; idle is an honest completed run.

## Research & Benchmarking

- [Inngest retries](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling/retries): reuse completed named steps and stable operation identity. Adopt per-item checkpoints; reject batch-wide repeated inference.
- [Inngest concurrency](https://www.inngest.com/docs/functions/concurrency): concurrency controls steps, not whole runs. Do not claim a concurrency setting alone prevents overlapping runs; use persisted assessments and conditional mutation.
- [Temporal retry policy](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/retry-policies.mdx): distinguish non-retryable results and bounded exponential retries. Adopt bounded transient retries; reject unlimited retries for a cost-sensitive model judgment. No Temporal dependency.

## Authority, compatibility and rollback

Automatic build is still the only permitted automatic disposition, with confidence threshold, author size preservation, mirror ownership and fail-closed governance. No discard, defer, scope widening or new approval policy. Existing rows without an assessment are eligible once. Rollback leaves additive nullable columns and audit history in place; do not drop recorded state. An assessment is evidence of a judgment, never proof that a failed apply changed work.

## Acceptance

- AC-1: An unchanged item already assessed as needing review receives no further scheduled model request; relevant input or policy changes make it eligible again.
- AC-2: Held older items do not prevent later eligible triaging items from being assessed.
- AC-3: Model failures, invalid responses, low confidence, review decisions, ledger failures and apply failures have distinct durable outcomes with bounded retry rules.
- AC-4: Each run has a bounded request/time budget and cannot overwrite a concurrent manual triage decision.
- AC-5: Existing scheduled-work reporting presents meaningful run counts and errors, including zero-progress and skipped work, rather than a misleading blanket ok.
- AC-6: Regression tests verify repeat suppression, change invalidation, queue fairness, retries, concurrent updates and safety gates.
