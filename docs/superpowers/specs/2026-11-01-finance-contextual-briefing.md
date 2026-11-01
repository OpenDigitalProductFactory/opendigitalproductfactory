---
status: active
---

# Finance contextual opening briefing

Backlog: `BI-9F118032`; Workroom: `WC-D3C29300`. Linked finding: `BI-46032D38`, owner audit `DOC-82684072`.

## Problem and scope

The owner opens Finance Specialist to enter an expense and instead receives routine technical release questions. The existing owner-attention convergence correctly decides which items need the owner, but its composer falls back to the first global decision when none matches the current Finance surface. Counts and domain relevance are different concerns. This child changes presentation only; it does not expand the counts repair or the provider recovery repair `BI-D0D2FF0D`.

## Design grounding

Extend [owner-attention convergence](2026-08-24-owner-attention-briefing-convergence-design.md), preserving its canonical `buildOwnerAttentionProjection` loader and balanced zero-owner silence. Reuse `opening-briefing.ts`, `opening-briefing-loader.ts`, `attention/triage.ts` (`isOverrideTier`, `overrideReason`), and existing Finance shell-catalog expense guidance. The served Expense entry form is the benchmark: title, dated/category/description/positive-amount items, optional receipts, draft or governed submission. Reuse `/finance/my-expenses/new`; no new workflow, projection, state, provider, capability, or urgency classification.

## Objectives

**OBJ-1:** Make a Finance opening useful for the current Finance task without headlining unrelated routine technical decisions.

**OBJ-2:** Keep genuinely urgent owner decisions visible, truthful owner counts, existing audience filtering and quiet/zero-owner behavior.

## Bounded behavior

Recognize Finance only by the path `/finance` or its descendants, removing query and fragment for this check. Other surfaces retain existing behavior. Keep quiet and zero-item branches first: balanced zero remains silent, assertive all-clear remains unchanged.

For a nonempty Finance owner list, choose the first canonical override-tier item before surface preference and explain its canonical override reason. This includes urgent decisions outside Finance. Otherwise choose the first current Finance surface item, then another Finance item. If only routine unrelated owner decisions exist, do not repeat their technical headline: offer current Finance guidance and link the complete, correctly counted owner list to the Needs-you inbox. No owner item is discarded from counts or the inbox.

On Spend and native expense routes, reuse existing localized catalog requirements with the native entry link. On other Finance routes, use a concise general Finance task invitation, without prescribing expense entry for an unrelated job. Keep the briefing deterministic, ephemeral, read-only and unpersisted; no model call or action execution. Existing translation/context mechanisms supply viewer locale where catalog copy needs it; no full localization claim.

## Acceptance criteria

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | On Finance Spend with only routine unrelated owner decisions, the opening gives native expense-entry guidance and a correct total owner-decision inbox link without a technical global headline. |
| AC-2 | OBJ-1 | A Finance decision is preferred to routine global work; other Finance routes receive general Finance guidance instead of expense-specific instructions. |
| AC-3 | OBJ-2 | A canonical overdue, due-today, or irreversible high-risk owner decision remains visible ahead of a routine local Finance item, with its canonical urgency reason and recorded link. |
| AC-4 | OBJ-2 | The loader still passes only canonical needsYouNow items; quiet and balanced zero-owner remain silent, assertive all-clear and non-Finance behavior remain unchanged. |
| AC-5 | OBJ-2 | Headline and no-headline paths count every actual owner decision exactly once, preserve audience filtering, and add no persistence, authorization change or provider work. |
| AC-6 | OBJ-1, OBJ-2 | Focused regressions are observed red then green, required local and protected checks pass, and the served owner Finance interaction is exercised before the audit outcome is claimed delivered. |

## Risks and verification

The main risk is suppressing an urgent global decision; canonical override selection and reason tests guard that boundary. Another risk is counting the unshown headline as if it were shown; test both count branches. Retain the 51-custodian/zero-owner loader regression. Test query/fragment and Finance-prefix false positives, native link/catalog requirements, non-Finance behavior, and current-surface preference. Review the final change independently, then exercise the served portal with authorized isolated fixtures. No production expense or authority changes. Rollback is a source revert; no data rollback exists.
