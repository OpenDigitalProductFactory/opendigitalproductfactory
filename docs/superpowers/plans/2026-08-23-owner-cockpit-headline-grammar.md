---
status: active
---

# Owner cockpit headlines: fix the four imperatives wearing question marks

**Backlog item:** BI-0AA9B679
**Date:** 2026-08-23

## Why

The owner cockpit renders one `HEADLINE` string on every attention card, making these among the most-read strings in the product. Four of them were imperatives closed with a question mark, which is not a grammatical question:

| AttentionSource | Was |
|---|---|
| `escalation` | `Choose what happens to this build?` |
| `ai-readiness-blocker` | `Choose an intelligence setup fix?` |
| `platform-health` | `Choose how to handle this outage?` |
| `business-journey` | `Choose how to fix this for customers?` |

Observed live on `/workspace` 2026-08-19. The remaining 15 entries were already correct — they are elliptical questions ("Approve this bill?" = "[Do you want to] approve this bill?"), which read fine.

## What changed

Each of the four is now a real question, keeping the same decision and the same plain register:

| AttentionSource | Now |
|---|---|
| `escalation` | `What should happen to this build?` |
| `ai-readiness-blocker` | `How should we fix your intelligence setup?` |
| `platform-health` | `How should we handle this outage?` |
| `business-journey` | `How should we fix this for customers?` |

New `owner-decision-copy.test.ts` pins the rule rather than just the strings:

- **The invariant** — no headline may open with an imperative (`choose`/`pick`/`select`/`decide`) and end in `?`. This is what actually shipped the bug, and it blocks the next one too.
- Every `AttentionSource` yields a non-empty headline.
- The four repaired strings, exactly.
- The elliptical-question headlines are unchanged, so the fix cannot over-reach.
- Every headline stays ≤ 60 chars so the cockpit card does not wrap.

The probe helper passes a neutral title, because `headlineFor()` branches on `title` for two sources; a neutral one exercises the `HEADLINE` table itself rather than those branches.

## One constraint worth recording

The first attempt used "How should we fix your **AI** setup?" and was caught by an existing assertion in `owner-decision.test.ts`: owner-facing copy must contain no bare technical acronym (`AI|API|DB|GPU|CI|CD`). The original wording said "intelligence" deliberately, for that reason. The final string preserves it.

That guard did exactly its job — worth noting because it is the kind of rule a copy change would otherwise quietly violate.

## Out of scope

- The other 15 headlines, the `SPECIALIST` table, and card layout or ordering.
- The raw-markdown Outcome rendering originally filed under BI-36ADD115 — already fixed since, by `toOutcomeStatement` in `owner-change-view.ts`.

## Verification

`vitest run lib/attention/ lib/build/outcome-statement.test.ts` — 25 files, 268 tests, green, including the pre-existing acronym guard and the markdown-reduction fixture that quotes the old string as historical input (left intact deliberately: it tests markdown reduction, not current copy).
