---
status: active
---

# Complete Immutable Review Pagination Amendment

**Backlog item:** BI-SIG-463E478D  
**Workroom:** WC-113D025E  
**Extends:** `2026-08-25-immutable-source-review-traversal-design.md`

## Observed recurrence

On commit `96c7d40719d9d89d2aa33f1afd66678226fdf3c4`, two Qwen3.8 27B design-spec runs for BI-7111AF0C read only lines 1–58 of 311, then recorded FAIL solely because the rest was unread. Each page returned `hasMore=true`, but terminal policy classified one successful read as complete and nudged the writer. This is substrate behavior, not a design finding.

## Decision

Keep the existing exact commit/path/blob binding, 3,200-character page ceiling, six-call ceiling, and terminal-writer replay. Extend terminal progress with immutable-page completeness derived from successful `read_source_at_version` results.

- A bound read with `hasMore=true` is partial evidence, not complete evidence.
- While partial evidence exists and budget remains, text exit nudges only the reader with the continuation cursor; the writer is withheld.
- A writer call while the latest contiguous attempt is partial is refused with an actionable continuation result and is not counted as a terminal writer attempt.
- Evidence is complete only when an exact ordered attempt starts at the beginning and ends with `hasMore=false`, or deterministic hydration produces it.
- Failed, conflicting, duplicated, replayed, or non-progressing pages never bridge a gap. Six incomplete calls stop input-required with no receipt.
- Search remains available for exploration, but cannot by itself prove complete-artifact review for design-spec, spec-approval, architecture-review, or plan-review gates.
- Non-initiative and non-bound tool loops remain unchanged.

No schema or receipt change. `ToolExecution` remains the audit source; source bytes stay bounded and redacted.

## Ordered implementation plan

1. Add failing policy tests for partial page, continuation, completed sequence, premature writer, gaps, and exhausted pagination.
2. Carry bounded reader-result metadata into terminal progress without exposing source content or weakening audit redaction.
3. Make surfaces, reminders, writer admission, and text exit depend on complete traversal.
4. Prove a 311-line fixture reaches the final page before its writer and incomplete traversal creates no receipt.
5. Run affected suites, typecheck, preflight, semantic review, local CI, DCO PR, and protected merge.

## Acceptance

- The exact BI-7111AF0C reproduction cannot record a disposition after page 1.
- A six-page, exact-bound artifact can reach `hasMore=false` and then expose exactly the writer.
- Gaps, identity conflict, and budget exhaustion fail closed without a writer or receipt.
- Existing short-artifact reviews, writer-only replay, and unrelated autonomous work retain behavior.

## Non-goals

No larger context window, higher tool limit, weaker reviewer independence, receipt fabrication, prompt-only workaround, or change to BI-7111AF0C business scope.
