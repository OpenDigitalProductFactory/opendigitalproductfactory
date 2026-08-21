---
title: Build Studio — one attention truth
date: 2026-08-21
status: active
owner: platform
backlogItem: BI-629C1F63
---

# Build Studio — one attention truth

**Backlog:** `BI-629C1F63` · **Decision:** `DI-BCC92F9AFC08` (Phase 2) · **Depends on:** `BI-101C107C` (PR #4423)

## Outcome

A Build Studio row states **one** attention answer, in **one** vocabulary, and says **why**. After this change no surface on `/build` can tell the operator they are needed while another surface on the same screen tells them nothing is needed.

## The defect

The operator saw a row badged **"Needs you"** in the left rail while that build's **Next** card read *"No action needed unless Build Studio asks for a decision."* Neither said what was wanted.

Two independent derivations answered the same question:

| | Producer | Shape |
|---|---|---|
| Rail row | `components/build/fleet-derivation.ts` `deriveNeedsAttention()` | `boolean` |
| Next card | `lib/build/customer-status-projection.ts` → `owner-status-reconciliation.ts` | 8-state `BuildStudioOwnerState` |

`deriveNeedsAttention()` evaluated seven distinct conditions and collapsed every one to `true`, discarding which fired. A row could therefore only ever print the literal string `"Needs you"` — the reason existed one line before it was needed and was thrown away.

## What made this worth doing cheaply

Three facts turned a projected wide refactor into a narrow one:

1. `owner-status-reconciliation.ts` **already** declared itself *"the one seam for Build Studio owner state"* and already owned the canonical vocabulary, including the `waiting-owner` → "Needs you" vs `blocked` → "Needs attention" distinction the rail was getting wrong.
2. `deriveFleetRowStatus()` **already preferred** that canonical state. It fell back to the boolean only when `ownerState` was null — and `BuildStudio.tsx` passed `activeOwnerState`, *singular, for the selected build*. Every non-selected row silently took the inferior path.
3. `customerStatuses` is a `Record<buildId, BuildStudioCustomerStatus>` loaded for **every** build by `loadBuildStudioCustomerStatuses` and already passed into `BuildStudio` — read only as `customerStatuses[activeBuild.id]`.

**The canonical per-row answer was already in the component, unused.** No new loader, query, or projection was required — only wiring what was already there.

## Design

`lib/build/build-attention.ts` is the single producer:

```ts
type BuildAttention = {
  state: BuildStudioOwnerState;  // canonical vocabulary, one source
  reason: string | null;         // the field the boolean discarded
  needsOwner: boolean;           // DERIVED from state, never independent
  fromRuntimeSignal: boolean;    // came from a signal the capsule can't see
};
```

### Union, not replacement — the load-bearing decision

The capsule projection is authoritative **when it has an opinion**, but it cannot see runtime freshness: a build whose watchdog died mid-phase, or whose `buildExecState` carries an error, still projects a healthy-looking capsule. Those local signals are therefore evaluated **first** and mapped onto the canonical vocabulary.

Deleting the local heuristic outright — the obvious reading of "collapse the duplicate" — would have lost exactly the failures the operator most needs to see. `fromRuntimeSignal` marks which answers came from that path so the union is assertable in tests.

### Invariant

`needsOwner` is derived from `state` via a closed set, never set independently. `build-attention.test.ts` asserts the property directly: **no case may report `needsOwner` while naming no reason.**

## Changes

- New `lib/build/build-attention.ts` + `build-attention.test.ts` (13 tests).
- `deriveNeedsAttention()` deleted; stall primitive moved `components/` → `lib/` (lib must not import components).
- Per-row canonical status wired into the rail and BS Queue; `ownerStateBadgeLabel()` is now the only producer of row status copy and the hardcoded `"Needs you"` is gone.
- Reason rendered as the row `title` and folded into its `aria-label`.
- Duplicate phase-label maps in `BuildOperatorOverview` deleted; `fallbackNow`/`fallbackNext` exported from `owner-change-view.ts` as the one map.

### The second instance, found while fixing the first

`BuildOperatorOverview.fallbackStatus/fallbackNextAction` duplicated the canonical maps and **disagreed** with them — "Building the solution" vs "Building the change", "Preparing for release" vs "Ready for a release decision". The damaging case: for `ship`, the duplicate returned *"No action needed unless Build Studio asks for a decision"* while the canonical map returned a real action. A ship-phase build is precisely the waiting-owner case, so the surface told the operator no action was needed on the one build that was waiting for them.

## Verification

- `tsc --noEmit` clean; **234 test files / 2,512 tests pass**.
- Ship-phase layout test now asserts the surface does **not** contain "No action needed", and does contain the reason on both the chip `title` and the Next card.
- Lands under the `BI-101C107C` surface ratchet as replace-and-delete: `components/build` non-test LOC **16,391 → 16,370**, baseline retightened in the same PR. The ratchet flagged the shrink and prompted the retighten — the guard working on the next PR after the one that introduced it.

## Not in scope

- Fully dissolving the four-layer projection stack (`progress-visibility` → `customer-status-projection` → `owner-status-reconciliation` → `owner-change-view`). This change makes the surface read one truth first; collapsing the stack itself is a separate structural job.
- `lib/portal-context/work-resolver.ts` carries a **third** private copy of the stall logic. Left alone here; worth its own item.
- The remaining operator-visible defects from the same review: the raw unclamped markdown outcome, the overlay drawer, and the duplicate BS Queue panel.
