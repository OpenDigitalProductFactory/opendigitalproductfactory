# Canonical Lifecycle Grammar — Stages + In-Stage States + Advancement Gates (CSDM-aligned)

**Status:** Design candidate — foundational workstream of EP-VSL-SURFACE
**Date:** 2026-08-15
**Track:** Enterprise-architecture / platform-data-model design
**Backlog:** `BI-E55991E9` (Workstream 0, FOUNDATIONAL) under `EP-VSL-SURFACE`
**Primary audience:** Platform architects wiring every governed entity's lifecycle onto one reportable grammar
**Depends on / extends (do NOT duplicate):**
- [2026-06-07-unified-lifecycle-backbone-design.md](2026-06-07-unified-lifecycle-backbone-design.md) — the canonical axes (`LifecycleStage`, `LifecycleStatus`, realization, freshness, currency), `resolveLifecycle`, `LifecycleEvent`, legal-transition maps. This spec **adds the in-stage State + advancement-gate layer on top of that backbone**; it does not re-found lifecycle.
- [2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md](2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md) — CSDM realization axis this grammar aligns to.

---

## 1. Problem

The Unified Lifecycle Backbone (`apps/web/lib/lifecycle.ts`, live) gave the platform **one set of ordered stages** (`plan → design → build → production → retirement`) and a **flat 3-value operational condition** (`draft · active · inactive`) with legal-transition maps and a universal append-only log (`LifecycleEvent`). That reconciled *which stage* every governed thing is in.

What it does **not** give us is the thing the owner actually asked for (2026-08-14), which is the **CSDM stage/state distinction**:

> A standardized way to articulate lifecycles as **Stages** and, within each stage, **States** — so we can (a) report on which stage every managed thing is in, and (b) within a stage, know the state that says whether it is *ready to move forward*.

Three concrete symptoms of the missing layer:

1. **`LifecycleStatus` is too coarse to gate advancement.** `draft/active/inactive` cannot express "in the `qualify` stage, but blocked" vs "in the `qualify` stage and ready to advance." Every surface that needs "is this ready to move forward?" has had to invent its own answer.

2. **The one place that *does* model stage-exit is hard-coded and un-reusable.** `apps/web/lib/crm/pipeline-inspector.ts` has `STAGE_EXIT_CRITERIA` (per-stage checklists) and `STAGE_STALE_THRESHOLDS_DAYS`, but only for CRM opportunity stages (`qualification/discovery/proposal/…`). It is exactly the canonical stage-gate the whole platform needs, trapped in one feature.

3. **`LifecycleEvent` records stage and status, but not state, so two-axis reporting is impossible.** The log has `fromStage/toStage/fromStatus/toStatus` — there is no `fromState/toState`, so "count-by-stage AND state-within-stage" cannot be computed from the ledger.

The result: the four other EP-VSL-SURFACE workstreams (CRM wiring, retain instrumentation, partner lifecycle, tech-stack board) would each re-invent "what are this thing's in-stage states and when may it advance." This spec exists so they don't — they declare a `LifecycleGrammar` and inherit gating, transition validation, event logging, and two-axis reporting for free.

## 2. Non-goals

- **Not** re-founding the backbone axes. `LifecycleStage`, realization, freshness, currency, `resolveLifecycle`, and `deriveTemporalPerspective` stay exactly as they are.
- **Not** collapsing OVSM stages, CRM opportunity stages, and `CustomerAccount.status` into one enum. The grammar is a *shape* multiple lifecycles instantiate, not a single global stage list. (Re-expressing each existing lifecycle in the grammar is acceptance criterion work, done without inventing new parallel machines.)
- **Not** a UI epic. This delivers the grammar (types + storage + reporting API) plus a minimal reporting read-model; rich per-lifecycle boards are the downstream BIs.

## 3. The grammar

### 3.1 Definitions

- A **Lifecycle** is an ordered set of **Stages** (the existing progression axis — e.g. backbone `plan…retirement`, OVSM `attract…retain`, an account's relationship arc).
- Each **Stage** declares a set of **States** — the *internal condition within that stage*. Every stage has exactly one **entry state** (assigned on stage entry) and at least one **exit-ready state** (the gate is open). States between them are stage-local (`on-track`, `blocked`, `waiting`, …).
- **Advancement** `Stage N → Stage N+1` is **gated**: it is legal only when the current state is an exit-ready state of Stage N **and** the target stage is reachable under the lifecycle's legal-transition map.
- **Two-axis reporting** is intrinsic: every governed entity resolves to *(stage, state)*. Reports project **count-by-stage** and **state-within-stage** (roll up each stage's states to a health band: `on-track` / `blocked` / `ready-to-advance`).

### 3.2 Canonical health bands (the roll-up)

Individual states are lifecycle-specific, but every state maps to one **health band** so cross-lifecycle reporting is uniform:

| Band | Meaning | Example states |
|---|---|---|
| `ready` | exit-ready; the gate is open | `qualified`, `quote-accepted`, `renewal-secured` |
| `on-track` | progressing normally, gate not yet open | `entered`, `in-discovery`, `active-use` |
| `blocked` | needs intervention to progress | `blocked`, `objection-open`, `at-risk` |

`ready`/`on-track`/`blocked` are the canonical band union; each declared state names its band. This is what lets "% of accounts ready to advance" be one query across every lifecycle.

### 3.3 Type shape (`apps/web/lib/lifecycle-grammar.ts`, new; pure, no server imports)

```ts
export const LIFECYCLE_HEALTH_BANDS = ["on-track", "blocked", "ready"] as const;
export type LifecycleHealthBand = (typeof LIFECYCLE_HEALTH_BANDS)[number];

export type StageState = {
  // Hyphenated per AGENTS.md §3 — EXCEPT keys that mirror an already-stored union value,
  // which retain the stored spelling so native decomposition round-trips (e.g. `at_risk`,
  // `closed_won`; see §5, and the historical-spelling exemption in customer-lifecycle.ts).
  key: string;
  label: string;
  band: LifecycleHealthBand;
  isEntry?: boolean;              // exactly one per stage
  isExitReady?: boolean;         // ≥1 per non-terminal stage
};

export type LifecycleStageDef = {
  key: string;                    // the Stage identifier within this lifecycle
  label: string;
  states: readonly StageState[];
  /** Stages legally reachable from here; terminal stages declare []. */
  advancesTo: readonly string[];
  isTerminal?: boolean;
  // Exit criteria + the stale clock are PER-STAGE (F3): the pattern generalised —
  // STAGE_EXIT_CRITERIA / STAGE_STALE_THRESHOLDS_DAYS in pipeline-inspector.ts — is keyed
  // by stage, and staleness is measured as time-in-stage (opportunity.stageChangedAt), not
  // time-in-state. Preserve the existing fallbacks on re-import: getStageExitCriteria's
  // default 2-item list and isStageStale's default of 14 days.
  /** Operator-facing checklist that justifies exit-ready (generalises STAGE_EXIT_CRITERIA). */
  exitCriteria?: readonly string[];
  /** Days-in-stage before the stage is flagged stale (generalises STAGE_STALE_THRESHOLDS_DAYS). */
  staleAfterDays?: number;
};

export type LifecycleGrammar = {
  key: string;                    // e.g. "customer-account", "ovsm", "tech-currency"
  label: string;
  stages: readonly LifecycleStageDef[];
};
```

### 3.4 Pure engine (same file)

```ts
// Validation performed once at module load (dev + test) — a malformed grammar throws.
export function validateGrammar(g: LifecycleGrammar): void;   // one entry state/stage, ≥1 exit-ready/non-terminal, advancesTo keys resolve

export function getStage(g, stageKey): LifecycleStageDef | null;
export function getState(g, stageKey, stateKey): StageState | null;

/** The gate: may this entity advance to `toStage` right now? */
export function canAdvance(
  g: LifecycleGrammar,
  from: { stage: string; state: string },
  toStage: string,
): { allowed: boolean; reason?: string };
//   false + reason when: state not exit-ready | toStage not in advancesTo | unknown keys.

/** Reporting projection over a set of (stage,state) points → two-axis rollup. */
export function summarizeLifecycle(
  g: LifecycleGrammar,
  points: readonly { stage: string; state: string }[],
): {
  byStage: Record<string, number>;
  byBand: Record<LifecycleHealthBand, number>;
  byStageBand: Record<string, Record<LifecycleHealthBand, number>>;
};
```

`canAdvance` is the single gate every lifecycle transition calls. `summarizeLifecycle` is the single reporting projection every board calls. Neither touches the DB.

## 4. Storage & the event ledger

### 4.1 Where the (stage, state) point lives

The grammar is a *shape*, not a new table of instances. Each governed entity keeps storing its own stage on its own column (`CustomerAccount.status`, `EaElement.lifecycleStage`, `DigitalProduct.lifecycleStage`, …). The **new** requirement is a home for the **in-stage State**. Two mechanisms, and **exactly one applies per entity** — an entity must not use both, or the (stage, state) source of truth becomes ambiguous:

- **Native decomposition** where the entity already conflates stage+state in one union (e.g. `CustomerAccount.status`'s `at_risk` is really `active`-stage + `at-risk`-state): the grammar's `resolve` mapper decomposes the stored value into `(stage, state)`. No new column. **Limit:** native decomposition can only express the states the stored union already encodes — you cannot represent `active`-stage + `blocked`-state unless the union carries an `at_risk`-like value. Where a native union is too coarse for the states a downstream BI needs to gate, that BI adopts the companion column instead.
- **`grammarStateKey` companion column** (nullable `String`) on entities whose stage column is a pure stage and needs a separate state. Named `grammarStateKey` (not `lifecycleState`) deliberately: `lifecycleState` is already a live column with unrelated semantics — `SkillDefinition.lifecycleState` (the `SkillLifecycleState` union) and `buildCustomerConfigurationItemLifecycleState` in `crm.ts` — so a generic `lifecycleState` would overload an existing name. Added only for entities the downstream BIs actually gate (introduced by those BIs, not pre-emptively here).

A per-entity **resolver** (mirroring `resolveLifecycle`'s kind-switch) maps each model's stored fields → `{ grammar, stage, state }`. This is the seam that keeps "no new parallel machine": one place per entity, referencing the shared grammar.

### 4.2 `LifecycleEvent` gains the state axis (migration)

`LifecycleEvent` (schema.prisma:8454) already logs stage+status transitions. Add two nullable columns so it records the state axis too:

```prisma
model LifecycleEvent {
  // … existing fields …
  fromState  String?   // StageState.key | null  (in-stage state at start)
  toState    String?   // StageState.key | null  (in-stage state after transition)
  // existing fromStage/toStage/fromStatus/toStatus retained unchanged
}
```

- Additive, nullable → backfill-free, safe migration. Existing rows keep `null` state.
- `fromStatus/toStatus` (the flat backbone condition) are **retained**, not repurposed — the grammar State is a finer axis layered above `LifecycleStatus`, not a replacement. A transition may set both (e.g. `toStatus:"active"`, `toState:"renewal-secured"`).
- **Open vocabulary (unlike the other four columns).** `fromStatus/toStatus` reference the *closed* `LifecycleStatus` enum; `fromState/toState` store an **arbitrary per-grammar `StageState.key`** (an open set, no single canonical enum). The DB column comment for `fromState/toState` must say so — "open per-grammar state key, not a canonical enum" — so it is not mistaken for a closed-enum mirror.
- **`toStatus` may legitimately be null for native-decomposition entities.** A `CustomerAccount`/`Opportunity` transition carries `toStage`+`toState` but its stored column is not a `LifecycleStatus`, so `toStatus` is null by design — not a data defect.

**Resolving `governedThingKind` for grammar entities (F1 — the blocking seam).** `LifecycleEvent.governedThingKind` is a plain `String` column, but the app-layer `parseGovernedThingRef` (`governed-thing-ref.ts`) validates it against the **closed** `GOVERNED_THING_KINDS` allowlist (`EaElement · DigitalProduct · InventoryEntity · ServiceOffering · Document · Agent · BusinessCapability`), whose header mandates that adding a kind also adds a `resolveLifecycle` branch + row-shape mapper in the same commit. `CustomerAccount` and `Opportunity` are **not** in it — and forcing them in would wrongly couple them to `resolveLifecycle` (the backbone-axis descriptor), a concern orthogonal to grammar state. Resolution: the grammar owns its **own** entity-kind registry — `LIFECYCLE_GRAMMAR_KINDS`, the set of entity kinds each declared grammar applies to (`customer-account`→`CustomerAccount`, `opportunity`→`Opportunity`, …). `recordLifecycleTransition` validates `governedThingKind` against `GOVERNED_THING_KINDS ∪ LIFECYCLE_GRAMMAR_KINDS` and does **not** route grammar-entity writes through `parseGovernedThingRef`'s closed check. The EA allowlist and its `resolveLifecycle` cascade stay closed; grammar entities log events through the widened write-path vocabulary. (Reads that need to know "is this an EA governed thing?" keep using the closed allowlist.)

### 4.3 A small writer + reporting read-model

- `recordLifecycleTransition(...)` (server lib) — validates via `canAdvance` when the stage changes, writes the `LifecycleEvent` row (with the state axis + actor Principal + optional evidence/toolExecution) for **grammar-driven** transitions. It is the funnel for grammar transitions, but **not** the only `LifecycleEvent` producer: `apps/web/lib/lifecycle/baseline-projector.ts:139` already emits `LifecycleEvent` rows (e.g. `toStatus:"inactive"` when a thing leaves the current-state estate). The two coexist — the projector logs backbone/estate transitions, `recordLifecycleTransition` logs grammar state/stage transitions; both append to the one universal ledger. (So the ledger is not "at 0" today; this BI adds the state axis and a second, grammar-aware writer.)
- `getLifecycleSummary(grammarKey)` (server lib) — resolves the live entities for a grammar, runs `summarizeLifecycle`, returns the two-axis rollup for any board. One query source of truth for count-by-stage + state-within-stage.

## 5. Re-expressing existing lifecycles (acceptance-criterion coverage)

The grammar ships with the following grammars declared and their resolvers wired — proving the shape holds without new parallel enums:

| Lifecycle | Stages source | State decomposition |
|---|---|---|
| **customer-account** | the 9-state `CustomerAccount.status` (`customer-lifecycle.ts`) | all 9 placed: stage arc `prospect → qualified → onboarding → active → closed`; within `active`, states `active` (on-track), `at_risk` (blocked, stored spelling kept), `suspended` (blocked); tombstones `superseded`/`archived` map to a single terminal `closed`-family stage as terminal states. No status left unplaced. |
| **opportunity** | CRM opportunity stages (`qualification/discovery/proposal/negotiation/closed_won/closed_lost`, stored underscore spelling kept) | lift `STAGE_EXIT_CRITERIA` + `STAGE_STALE_THRESHOLDS_DAYS` verbatim into each **stage's** `exitCriteria`/`staleAfterDays`; preserve the default 2-item criteria list and default 14-day stale fallback. `pipeline-inspector.ts` re-imports these from the grammar (behaviour-preserving). |
| **backbone** (`EaElement`/`DigitalProduct`/`Agent`) | `plan…retirement` | each stage's `advancesTo` **derives from `LIFECYCLE_STAGE_TRANSITIONS`** (single source — the grammar must not restate the legal map, or the two drift); map flat `LifecycleStatus` → band: `active`=on-track/ready, `draft`=on-track, `inactive`=terminal. |
| **tech-currency** | Currency axis (`current · approaching-eol · unsupported · end-of-life`) | each currency value is both stage and its own band (`current`=on-track, `approaching-eol`=blocked, `unsupported`/`end-of-life`=blocked/terminal). Consumed by BI-6328BCA6. |
| **ovsm** | the six primary OVSM stages (`attract · capture · qualify · deliver · settle · retain`; the cross-cut `trust-compliance`/`operate-improve` and conditional `return-inspect`/`receive-store` stages in `operational-value-stream.ts` are out of scope here) | states per stage declared minimally; consumed/enriched by BI-9078F4EE + BI-A72D29BE. |

Only `opportunity` and `customer-account` need their resolvers *and* a consuming surface touched in this BI (to prove the round-trip and de-duplicate `STAGE_EXIT_CRITERIA`). The others declare their grammar here and are consumed by their own downstream BIs — this BI does not rewrite those surfaces. `validateGrammar` runs against all declared grammars at test time, so even the un-wired ones are shape-proofed.

## 6. CSDM mapping (documented, acceptance criterion)

CSDM models a service/CI lifecycle as **stages** (Design → Build → Operate → Retire family) each carrying an **operational status/substate**. The grammar realizes that exactly: Stage = CSDM lifecycle stage, StageState = CSDM substate, `isExitReady` = CSDM "ready for next stage" gate, `LifecycleEvent` = the CSDM lifecycle-transition audit. Section 6 of the spec tabulates each declared grammar's stages/states against the CSDM stage/substate vocabulary.

## 7. Blast radius & safety

- **Additive migration only** (`LifecycleEvent.fromState/toState`, nullable). No column drops, no backfill, no enum column value removed. Per memory *new-prisma-model-gate-cascade* this is a column-add not a model-add, so the lighter migration path applies. Note the enum-mirror discipline differs per column: the *closed* union `LIFECYCLE_HEALTH_BANDS` (which no column stores directly) and the closed `LifecycleStatus` follow the canonical-enum comment rule, but `fromState/toState` hold **open per-grammar keys** — their column comment states "open per-grammar state key, not a canonical enum" so a reviewer does not expect an MCP enum mirror for them.
- **Write-path vocabulary widened, EA allowlist unchanged** (F1). `recordLifecycleTransition` accepts `GOVERNED_THING_KINDS ∪ LIFECYCLE_GRAMMAR_KINDS`; `GOVERNED_THING_KINDS` and its `resolveLifecycle` cascade are untouched, so no EA-governed-thing reader regresses.
- **`pipeline-inspector.ts`** changes from *owning* `STAGE_EXIT_CRITERIA` to *importing* it from the `opportunity` grammar — behaviour-preserving; existing `pipeline-inspector.test.ts` must stay green (regression guard).
- **No new global enum on `LifecycleStatus`.** The grammar sits above it. Existing `resolveLifecycle` callers are untouched.
- Pure engine (`lifecycle-grammar.ts`) is fully unit-testable with no DB; `validateGrammar` runs on every declared grammar at test time so a malformed grammar fails CI, not production.

## 8. Testing

- `lifecycle-grammar.test.ts` — `validateGrammar` rejects (no entry / no exit-ready / dangling `advancesTo`); `canAdvance` allows only from exit-ready to legal targets and returns typed reasons otherwise; `summarizeLifecycle` two-axis rollup arithmetic.
- Resolver tests — `customer-account` decomposition (esp. `at_risk` → active+at-risk, tombstones → terminal) and `opportunity` criteria parity with the pre-existing `STAGE_EXIT_CRITERIA`.
- `pipeline-inspector.test.ts` stays green after the re-import (behaviour-preserving refactor).
- Migration applies cleanly; a `recordLifecycleTransition` round-trip writes a row carrying both `toStatus` and `toState`.

## Backlog Coverage

Atomic plan rationale: this is one independently useful, self-contained substrate BI (`BI-E55991E9`). The grammar types + pure engine, the `LifecycleEvent` state-axis migration, the writer/reporting libs, and the two proving resolvers (`customer-account`, `opportunity`) are not separately shippable — the engine without the event-log axis cannot record two-axis reporting, the migration without a writer accumulates nothing, and the grammar without at least one wired resolver is an unproven shape. The other four EP-VSL-SURFACE BIs each declare/consume their own grammar and ship independently on top of this one.
