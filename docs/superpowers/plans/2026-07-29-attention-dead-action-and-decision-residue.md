# "Needs you" dead action + stale decision residue — plan

- Date: 2026-07-29
- Backlog items: **BI-90B6D8C5** (the no-op `Review this decision` button), **BI-FE034C1E** (decision residue for abandoned builds never clears)
- Epic: EP-ATTENTION-SURFACE
- Reported by: CEO, live on `/workspace/inbox` — "when I click on review this decision, nothing happens"
- Surfaces touched: `apps/web/lib/attention/*`, `apps/web/lib/quality/*`, `apps/web/lib/wiki/decision-{audit,help}.ts`, `apps/web/components/attention/OwnerDecisionCards.tsx`, `/workspace/inbox`, `/workspace`

## Design grounding

Source of truth for this surface: the [Attention Surface foundation](../specs/2026-06-23-human-attention-surface-design.md) §6, the [cognitive-load redesign](../specs/2026-07-17-needs-you-cognitive-load-redesign-design.md), and the [restaurant-owner attention reconciliation design](../specs/2026-07-22-restaurant-owner-attention-reconciliation-design.md) §1.

That last doc **asserted the defect away**: it recorded the `?attentionId=` deep link as satisfying the BI-8EA88797 exact-target requirement. It did not, because no consumer was ever built. This plan corrects that section in place rather than creating a competing design — the contract it states (plain-language copy, raw title behind progressive disclosure, no cross-rail teleport for the owner persona) is unchanged and still enforced by `owner-decision.test.ts`.

For the hygiene half, the source of truth is [escalation surface honest context and auto-resolve](../specs/2026-06-23-escalation-surface-honest-context-and-auto-resolve-design.md) and its implementation `lib/quality/escalation-staleness.ts` (BI-467E8F8D). This plan extends that existing doctrine to a second table rather than inventing a new mechanism.

No new spec artifact: both items are defects against contracts that already exist.

## Evidence (live, 2026-07-29)

Reproduced in-browser on the running portal. Clicking `Review this decision` appends `?attentionId=…` to the URL and leaves the page text byte-identical (6087 chars before and after). Of the 12 cards on the live inbox, **10 carried the dead link** — 6 `ai-decision`, 4 `business-journey`. Only `Review bill` and `Review draft` navigated anywhere.

Joining the 6 decision rows against their builds:

| DecisionInteraction | buildId | FeatureBuild.phase |
|---|---|---|
| DI-58465A1C784B | FB-1DB2A3B5 | abandoned |
| DI-8A828E51F84E | FB-80E3FA94 | abandoned |
| DI-5C8098BDC64D | FB-B30EDA86 | abandoned |
| DI-D6C2C52BCF1C | FB-41D50AF1 | abandoned |
| DI-B1D4E336A4F8 | FB-812DA73B | abandoned |
| DI-2DB4DF4EDED6 | FB-F858D129 | abandoned |

Every card claimed `build FB-XXXXXXXX stays blocked` about a dead build.

## Root causes

1. **Self-link fallback.** `ownerChoices` (`lib/attention/owner-decision.ts`) emitted `/workspace/inbox?attentionId=<id>` when an item had no owner-safe action. `attentionId` was written in three places and read in zero.
2. **`isOwnerSafeHref` strips the only action.** It rejects `/ops`, `/build`, `/admin`, `/platform`. For `ai-decision` (`/platform/ai/decisions/<id>`) and `business-journey` (`/ops/journeys?…`) that is the *only* action the source carries, so the filter removed it and the placeholder replaced it.
3. **`FB-` never parsed from `blastRadius`.** `owner-technical-detail.ts` read the build id only from the deep link's `buildId` query param. An `ai-decision` deep link has no query string, so `Feature build` read `Not attached` and no `Resume build` link was generated — suppressing the one route to the surface that *can* answer the gate.
4. **No clear path for decision residue.** Abandoning a build never touches its `DecisionInteraction`. `runEscalationHygiene` sweeps this exact ghost shape but only for `PlatformIssueReport`.

## Phase 1 — retire the residue (BI-FE034C1E)

New pure selector `lib/quality/decision-residue-staleness.ts`, deliberately mirroring `escalation-staleness.ts` so the two read alike:

- `selectWithdrawableDecisions(rows)` withdraws a row only when it is **build-linked** AND that build's life is provably over: `supersededByEpicId` set, phase `abandoned`, phase `complete`/`failed`, or the originating BacklogItem is `done` / triaged `discard`|`duplicate`. Phases still in flight and `panicked` (a live, recoverable stall) are kept.
- Rows with `buildId` null are **never** swept — those come from the org-business and profession gates and are answered by a human at `/coworker-decisions/review`.
- `buildWithdrawnHumanOutcome` writes an honest machine record: `type: "withdrawn"`, `resolvedBy: "system:decision-residue-hygiene"`, `clearsGate: false`, `candidateMaterial: false`, no answer, no rationale, no `EscalationCapture`, and `chosenOptionId` untouched.

Wired as a second phase inside `runEscalationHygiene`, so all three existing callers (`/workspace/inbox` render, `/ops` render, the 15-minute `issue-report-triage` cron) get it. Idempotent: a withdrawn row's `humanOutcome` is no longer null, so it leaves the query permanently.

### Keeping the withdrawal honest downstream

A non-empty `humanOutcome` previously implied "a human resolved this". Three readers needed teaching:

| Reader | Was | Now |
|---|---|---|
| `decision-perspective/persistence.ts` `interactionWasCleared` | requires `escalationCapture && clearsGate === true` | unchanged — a withdrawal satisfies neither, so it can never masquerade as a passed gate |
| `wiki/decision-audit.ts` `toAuditRow` | `resolvedByHuman = escalationCapture \|\| humanOutcome non-empty` | excludes withdrawals; new `withdrawn` flag; `awaitingHuman` false for both |
| `wiki/decision-help.ts` | `resolved` → *"a human already answered this"* | new `withdrawn` branch → *"Closed on its own…"*, checked first |
| `decision-perspective/weight-inference-adapter.ts` | selects on `chosenOptionId NOT NULL` | unchanged — a withdrawal never sets it, so it is never read as an option pick |

## Phase 2 — remove the dead action (BI-90B6D8C5)

- `ownerChoices` no longer synthesizes a fallback. No usable action → **no button**.
- New `OwnerDecisionAudience` (`"worker" | "operator"`), mapped from the existing Simple/Full rail cookie (`lib/navigation/nav-mode.ts`) by `/workspace/inbox` and `/workspace`:
  - **Simple (`worker`)** — builder rails stay out of owner buttons (EP-NAV-COHERENCE, unchanged persona contract). The card renders `card.handoff`, a plain sentence naming who holds it and pointing at Technical detail.
  - **Full (`operator`)** — the rail caption already says "showing everything, including builder and platform tools", so the item's real action *is* the card's action. `Review evidence` and `See what failed` replace the generic placeholder; both are also more specific labels than the banned generic `Review this decision` that `owner-first/ux-audit.ts` and `restaurant-cockpit/service-readiness.ts` already flag.
- `readFeatureBuildId` now falls back to the `FB-` id in `triage.blastRadius`, restoring `Feature build` and the `Resume build` builder action.

### Regression guard

`owner-decision.test.ts` gains a cross-source invariant: for every `AttentionSource`, every builder-rail href, and both audiences, no choice href may match `^/workspace/inbox` or contain `attentionId=`, and a card with no choices must carry a `handoff`. A future source cannot silently reintroduce a self-link.

## Non-goals

- **The resolution loop itself** — answering one of these decisions from the inbox is [BI-7D99B25C](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues) (open, `build`/medium), which composes EP-WWMD-MCP BI-WWMD-MCP-08/09 (`wwmd_record_outcome`, both still open — the handler exists nowhere in code). Until it lands, the only surface that can capture human direction is `DecisionPerspectiveGatePanel` in Build Studio. This PR makes that reachable and stops the card lying; it does not build the loop.
- No change to `isOwnerSafeHref`'s rail policy for the worker persona, the plain-language copy contract, the `owner-routing` lane rules, or the build abandon path.
- No new Prisma model, column, or migration — the withdrawal reuses the existing `humanOutcome` Json column.

## Test strategy

- `lib/quality/decision-residue-staleness.test.ts` — the abandoned-build case by id; live-build and `panicked` rows kept; complete/failed/superseded/item-done/won't-do reasons; `deferred`-but-wanted kept; never sweeps a non-build-linked row; mixed batch; and the honesty properties of the withdrawal payload (no gate clear, no candidate material, no answer, no `chosenOptionId`, sweep-attributed) plus `isWithdrawnHumanOutcome` rejecting look-alikes from other writers.
- `lib/attention/owner-decision.test.ts` — the cross-source no-self-link invariant; Simple-view suppression + handoff; Full-view promotion of the real action; `FB-` recovery from blast radius; existing plain-language and acronym contracts unchanged.
- Functional verification on the live install: the 6 ghost cards clear and the count drops; a live build's gate card is untouched.
