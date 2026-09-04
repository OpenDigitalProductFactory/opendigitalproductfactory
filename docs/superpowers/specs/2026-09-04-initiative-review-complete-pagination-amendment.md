---
status: active
---

# Immutable Review Completion Amendment

**Backlog item:** BI-SIG-463E478D  
**Workroom:** WC-113D025E  
**Extends:** `2026-08-25-immutable-source-review-traversal-design.md`

## Observed recurrence

On commit `96c7d40719d9d89d2aa33f1afd66678226fdf3c4`, two BI-7111AF0C design-spec runs read only lines 1–58 of 311, then recorded FAIL because the rest was unread. Each page returned `hasMore=true`, but policy treated one read as complete and nudged the writer.

## Decision

Keep the existing exact commit/path/blob binding, 3,200-character page ceiling, six-call ceiling, and terminal-writer replay. Extend terminal progress with immutable-page completeness derived from successful `read_source_at_version` results.

- A bound read with `hasMore=true` is partial evidence, not complete evidence.
- While partial evidence exists and budget remains, text exit nudges only the reader with the continuation cursor; the writer is withheld.
- A writer call during a partial attempt is refused with an actionable continuation and is not counted as a terminal writer attempt.
- Evidence is complete only when an exact ordered attempt starts at the beginning and ends with `hasMore=false`, or deterministic hydration produces it.
- Invalid or non-progressing pages never bridge a gap. Six incomplete calls stop input-required without a receipt.
- Search remains exploratory; it cannot prove complete review for design-spec, spec-approval, architecture-review, or plan-review.
- Other tool loops, schemas, and receipts remain unchanged. `ToolExecution` remains the bounded audit source.

## Objective

**OBJ-REVIEW-COMPLETE:** A reviewer reads a bound artifact before disposition, with bounded context, exact identity, and fail-closed behavior.

## Ordered implementation plan

1. Add failing tests for partial pages, continuation, completion, premature writer, gaps, and exhaustion.
2. Carry bounded reader metadata into terminal progress without exposing source content.
3. Make surfaces, reminders, writer admission, and text exit depend on complete traversal.
4. Prove a 311-line fixture reaches its final page before the writer; incomplete traversal creates no receipt.
5. Run affected suites, typecheck, preflight, review, local CI, DCO PR, and protected merge.

## Acceptance

| ID | Objective | Statement |
| --- | --- | --- |
| AC-PARTIAL | OBJ-REVIEW-COMPLETE | The BI-7111AF0C reproduction cannot record a disposition after page 1. |
| AC-COMPLETE | OBJ-REVIEW-COMPLETE | A six-page exact-bound artifact reaches `hasMore=false` before exactly the writer is exposed. |
| AC-FAIL-CLOSED | OBJ-REVIEW-COMPLETE | Gaps, identity conflict, and exhausted pagination create no writer or receipt. |
| AC-COMPAT | OBJ-REVIEW-COMPLETE | Short-artifact reviews, writer-only replay, and unrelated autonomous work retain behavior. |

## Non-goals

No larger context window, weaker reviewer independence, receipt fabrication, prompt workaround, or BI-7111AF0C scope change.
