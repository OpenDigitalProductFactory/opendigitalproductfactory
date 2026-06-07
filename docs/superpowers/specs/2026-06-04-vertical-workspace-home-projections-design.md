---
title: Vertical workspace home projection service — GearInterface, Calibrator, and Governor signal translator
date: 2026-06-04
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-3E8D2CF5
epic: EP-REDUCTION-GEAR-ARCH
extends:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5.6, §5.7 (parent — names the signal type, the translation contract, the substrate boundary)
  - docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6 (Calibrator + Governor mechanics; already shipped under BI-861C4959 / PR #1095)
relates-to:
  - docs/superpowers/specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md (downstream consumer — the HVAC dispatcher home reads through this service)
  - docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md (sibling — primitives consume the signals this service emits)
  - docs/superpowers/plans/2026-06-04-hvac-dispatcher-workspace-home.md (Dale plan — Phases 3-5 + 8 depend on this spec landing first)
  - PR #1237 (substrate, merged 2026-05-27)
  - PR #1438 (architect amendments, merged)
  - PR #1439 (unconfigured-archetype telemetry, merged)
upstream-deps-satisfied:
  - BI-861C4959 (Calibrator + Governor + Ring 2→3 emitter) — DONE, on main at `apps/web/lib/gear-interface/{calibrator,governor}/`
  - BI-1CCC6264 (workspace-home substrate) — DONE, on main
  - BI-44C34478 (semantic archetype slug in GearInterface.archetypeContext) — see §6 for status verification
---

# Vertical workspace home projection service

## 1. The question

[BI-3E8D2CF5](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues?q=BI-3E8D2CF5) asks for a typed projection service that wraps GearInterface query APIs, Calibrator trust snapshots, and Autonomy Governor decisions into worker-native `WorkspaceHomeSignal` objects. The parent vertical-workspace-home spec ([§5.7](2026-05-24-vertical-workspace-home-design.md)) sketches the API surface; this spec fills in the contract, the translation rules, the file layout, the test surface, and the verification protocol.

This is **the producer-side contract** that vertical contributions (BI-CE6AF925 HVAC, follow-on clinic / retail / MSP / training) consume. Without this service, every vertical contribution would either:

- Import `getSlipByReason`, `prisma.gearInterface.findMany`, `getTrustForTriple`, `governor.consult` directly into UI components — the failure mode the parent spec explicitly forbids; OR
- Invent a per-archetype translation layer — sprawl that violates `architecture-over-shortcuts` and recreates the projection logic N times.

The projection service is **the one place** GearInterface vocabulary becomes worker vocabulary.

## 2. What the parent spec already establishes (do not duplicate)

For the avoidance of doubt:

- **`WorkspaceHomeSignal` type** at parent §5.7. Discriminated union over `source.kind ∈ {gear-interface, governor, calibrator}` with `severity, label, body, actionHref?`. **Canonical.**
- **Translation table** at parent §5.6 mapping GearInterface concepts (`archetypeContext`, `meanTorqueTechnical`, `slipReason`, `outcomeType`) to worker-home labels. **Canonical.**
- **The boundary rule.** "The home never renders GearInterface fields directly. It translates them into operational signals." **Canonical and non-negotiable.**
- **Ring-scope discipline** at parent §5.7. Worker slot consults of wiki recall/decide MUST scope by `principleRingScope = worker`. **Canonical.**
- **Banned-copy assertion** at parent §10. The full list: `gear, ring, torque, slip, wear, triple, shaft, calibration, contribution model, cockpit`. **Canonical.**

This extension does NOT change any of those. Anything in this doc that contradicts the parent is a bug.

## 3. Gap analysis — what this spec adds beyond the parent

| Parent spec asserts | What this spec adds |
| --- | --- |
| The signal type discriminated union shape (§5.7). | Per-variant loader implementations: which GearInterface query helpers feed `kind: "gear-interface"` signals, which Calibrator helpers feed `kind: "calibrator"` signals, which Governor outputs feed `kind: "governor"` signals. |
| The 6-row translation table (§5.6). | The full translation rule set including severity assignment, action-href derivation, and the empty-state path when no rows match. |
| "Module may call `getTripleWearReadings`, `getSlipByReason`, etc." (§5.7). | The complete dependency set with exact import paths, grounded against the substrate on main. |
| Archetype-scoping (BI-44C34478 dependency). | Loader-side normalization shim contract, transitional-only, with sunset test. |
| Worker UI never imports GearInterface (§5.7). | A vitest static-analysis assertion that fails on banned imports anywhere under `apps/web/components/workspace-home/`. |
| Banned-copy assertion at the contribution level. | Banned-copy assertion runs on the **projection service's** output before it reaches any renderer. The projection is where the translation is enforced; the contribution can't fix a leak the projection emits. |

## 4. The typed contract

The parent spec at §5.7 specifies:

```ts
type WorkspaceHomeSignal = {
  id: string;
  severity: "info" | "warning" | "critical";
  label: string;
  body: string;
  actionHref?: string;
  source:
    | { kind: "gear-interface"; rowIds?: string[]; capabilityName?: string; archetypeContext?: string | null }
    | { kind: "governor"; decisionId: string; outcome: "allow-auto" | "allow-with-notify" | "require-hitl" | "escalate" | "block" }
    | { kind: "calibrator"; trustKey: string; window: QueryWindow };
};

async function loadWorkspaceHomeSignals(input: {
  archetypeContext: string;     // semantic slug only
  contributionId: string;
  window: QueryWindow;
}): Promise<WorkspaceHomeSignal[]>;
```

This spec extends the contract with three loader-internal types and one public test helper. None of these change the parent's `WorkspaceHomeSignal` shape:

```ts
// apps/web/lib/workspace-home/projections/types.ts (proposed)

/** What the loader needs from a single GearInterface row to translate it. */
export type GearInterfaceProjectionSeed = {
  rowId: string;
  capabilityName: string;
  archetypeContext: string | null;
  outcomeType: "graduation" | "veto" | "transmission" | string;
  slipReason: string | null;
  meanTorqueTechnical: number | null;
  sourceEventAt: Date;
};

/** What the loader needs from a Calibrator trust reading. */
export type CalibratorProjectionSeed = {
  trustKey: string;
  score: number;          // 0..1
  sampleSize: number;
  recentFailures: number;
  humanGraded: number;
  threshold: number;      // the tier-elevation threshold the score is below/above
  windowDays: number;
};

/** What the loader needs from a Governor verdict + the gate that triggered it. */
export type GovernorProjectionSeed = {
  decisionId: string;
  verdict: "allow-auto" | "allow-with-notify" | "require-hitl" | "escalate" | "block";
  triple: {
    agentId: string;
    capabilityName: string;
    archetypeContext: string;
  };
  action: string;            // e.g. "complete-phase-build" — the caller-supplied gate name
  rationale: string;
  recordedAt: Date;
};

/** Test-only helper. Translates a fixture seed without touching the DB. Used by per-archetype
 *  translation tests and by the substrate's banned-copy assertion. */
export function translateGearInterfaceProjection(seed: GearInterfaceProjectionSeed): WorkspaceHomeSignal;
export function translateCalibratorProjection(seed: CalibratorProjectionSeed): WorkspaceHomeSignal;
export function translateGovernorProjection(seed: GovernorProjectionSeed): WorkspaceHomeSignal;
```

The three `translate…Projection` functions are pure and exported so:
- Per-archetype tests can assert the translated output without spinning up Postgres.
- The substrate-level banned-copy assertion runs against the union of translated outputs.
- A future archetype that needs a vocabulary override can compose by wrapping these translators rather than reaching into the database.

## 5. Translation rules

### 5.1 GearInterface → signal (extends parent §5.6 table)

| Source row pattern | Severity | Label | Body | actionHref |
| --- | --- | --- | --- | --- |
| `outcomeType = graduation` AND `archetypeContext = this` | `info` | "Coworker can handle more of this flow" | `"{capabilityName} graduated to {graduationToAutonomy} after {graduationSampleSize} successful runs"` (worker-vocabulary) | link to the Cockpit graduations panel filtered by capability — admin-scoped (HR-000/HR-100) only |
| `outcomeType = veto` AND `archetypeContext = this` | `warning` | "Automation blocked for safety or policy" | rationale projected verbatim if it passes the banned-copy filter; otherwise a generic "Recently vetoed by a staff member" | link to the veto record — admin-scoped |
| `slipReason = failed-outcome` (recent window) | `warning` | "Automation did not complete" | `"{capabilityName} failed to complete on {sourceEventAt}"` projected to dispatcher / clinic / retail vocabulary via contribution lookup | link to the originating WorkItem if present, else null |
| `slipReason = human-override` | `info` | "Recently corrected by staff" | "{actor.label} updated a coworker decision" | null |
| `slipReason = capability-gap` | `warning` | "Needs setup before coworker can help" | "This kind of work isn't connected yet — admin setup is needed" | `/storefront/setup` |
| `meanTorqueTechnical < 0.5` over rolling N=20 | `warning` | "Needs dispatcher review" | "Recent automation outcomes are inconsistent on `{capabilityName}`" | null |

Rows with `archetypeContext ≠ this contribution's archetype` are dropped before translation — archetype-scoping is the loader's first filter, not the renderer's.

### 5.2 Calibrator → signal

The Calibrator emits trust readings continuously; the projection surfaces them only when they cross a threshold the worker cares about:

| Reading pattern | Severity | Label | Body | actionHref |
| --- | --- | --- | --- | --- |
| `score < ESCALATE_THRESHOLD` AND `sampleSize ≥ 5` | `critical` | "Automation health is degrading" | `"{capabilityName} has slipped to {Math.round(score*100)}% across {sampleSize} recent runs"` projected to worker vocabulary | admin-scoped link to the capability's trust panel |
| `score ≥ next-tier-threshold` AND `sampleSize ≥ next-tier-min` | `info` | "Coworker is ready to take more of this work" | "{capabilityName} reached graduation threshold" | admin-scoped graduation panel |

Calibrator readings that don't cross a threshold are NOT surfaced. Worker home is not a vital-signs monitor; it surfaces actionable inflections, not raw scores.

### 5.3 Governor → signal

Governor verdicts feed the **coworker-handoffs covenant slot** (parent §5.5). Each verdict that touches this worker's archetype context becomes a row:

| Verdict | Severity | Label | Body | actionHref |
| --- | --- | --- | --- | --- |
| `require-hitl` | `warning` | "Decision waiting for your go-ahead" | `"{action} on {capabilityName}: {rationale}"` projected through contribution vocabulary | the originating decision interaction surface |
| `escalate` | `critical` | "Decision needs senior review" | as above | as above |
| `block` | `info` | "Automation blocked — review when convenient" | "{action} was blocked: {rationale}" | as above |
| `allow-with-notify` | `info` | "Coworker completed `{action}` — review on your schedule" | as above | the resolved decision surface |
| `allow-auto` (silent) | — DROPPED before translation — | | | |

The `allow-auto silent` verdict is recorded for calibration (BI-861C4959 mandates the audit row) but **must not** appear on the worker home — it's the "completed without ceremony" path and adding it to the home is noise. Audit visibility lives in admin Cockpit.

### 5.4 Empty state

When no signals match the input, the loader returns `[]`. The renderer's job is to show the slot's empty-state copy (per primitive registry §6); the projection NEVER returns a placeholder row. Synthetic "no signals yet" rows have caused exactly the kind of fabrication the kernel `Never Fabricate` commandment exists to prevent.

### 5.5 Banned-copy guarantee

Every translator runs its candidate output through a banned-token filter before returning:

```ts
const BANNED_TOKENS = /\b(gear|ring|torque|slip|wear|triple|shaft|calibration|cockpit)\b/i;
// Plus contribution-model as a phrase: /\bcontribution[ -]?model\b/i
```

If a candidate label, body, or actionHref text contains a banned token, the translator MUST:

1. Substitute the worker-vocabulary mapping (per contribution's `vocabulary` block — see parent §6.1 HVAC example).
2. If no vocabulary mapping exists, fall back to a generic worker-phrase (e.g. "Recent automation event") AND log a `[projection-vocabulary-gap]` warning with `capabilityName` so the gap surfaces in observability.
3. Never emit the row with banned text in it. Return null and skip.

Per parent §10: the banned-copy vitest assertion runs over the **union of all translator outputs**, not just per-slot rendered HTML. A leak at the projection is a leak in every contribution that consumes it.

## 6. Archetype-scoping — BI-44C34478 status and shim contract

The parent spec §5.7 says the projection service depends on **BI-44C34478** to land canonical semantic `StorefrontArchetype.archetypeId` in `GearInterface.archetypeContext`. The Ring 2→3 emitter from BI-861C4959 is already writing this field — see PR #1095 verification, which confirmed `archetypeContext` populated with `cmpims3wm090h6ymghzj9wj88` (a `StorefrontConfig.archetypeId` cuid) on a real seeded row.

**Status to verify at implementation time:** is the value a **semantic slug** (`"hvac-contractor"`) or a **cuid FK** (`"cmpims3wm090h6ymghzj9wj88"`)? The PR #1095 evidence sentence suggests cuid. The parent spec is explicit that the projection service compares by semantic slug, never by FK.

Two paths:

- **A — BI-44C34478 done**, `archetypeContext` carries semantic slugs. The loader filters `WHERE archetypeContext = ?` with the semantic slug directly. No shim needed.
- **B — BI-44C34478 not done**, `archetypeContext` carries cuids. The loader runs a **transitional shim**: look up `StorefrontArchetype.archetypeId` (the semantic slug) by `id` (cuid) once at the start of `loadWorkspaceHomeSignals`, build a cuid→slug map for the active install's archetypes, and translate before filtering. The shim:
  - Lives only in `apps/web/lib/workspace-home/projections/archetype-scope.ts`.
  - Carries a `TODO(BI-44C34478)` comment with the removal date target.
  - Ships with a **sunset test** that asserts the shim's existence; the test fails-loud after BI-44C34478 is marked done, forcing removal.

The implementer files a single-line evidence record on this BI naming which path is taken.

## 7. Module layout

```
apps/web/lib/workspace-home/projections/
├── index.ts                       — Public surface: loadWorkspaceHomeSignals + translate{GearInterface,Calibrator,Governor}Projection
├── types.ts                       — WorkspaceHomeSignal + ProjectionSeed types
├── archetype-scope.ts             — Transitional cuid→slug shim (per §6 path B); empty when path A is in effect
├── gear-interface-projection.ts   — Reads `apps/web/lib/gear-interface/query.ts` + emits signals
├── calibrator-projection.ts       — Calls `getTrustForTriple` etc. + emits signals
├── governor-projection.ts         — Reads governor.consult outputs from the DecisionInteraction audit row + emits signals
├── translation-rules.ts           — The §5.1-5.3 tables encoded as pure functions
├── vocabulary.ts                  — Contribution-vocabulary lookup helper for substitution
└── *.test.ts                      — Per-file unit tests + an integration test of loadWorkspaceHomeSignals against fixtures
```

The module's only public exports are `loadWorkspaceHomeSignals`, the three `translate…Projection` functions, and the `WorkspaceHomeSignal` type. **Nothing else.** UI components import only from this surface.

A vitest static-analysis test asserts no file under `apps/web/components/workspace-home/` imports from `apps/web/lib/gear-interface/`. The test reads the typescript AST of every `.tsx` in that directory and matches against the prohibited import roots.

## 8. Ring-scope discipline (parent §5.7 extension)

When a worker slot calls the wiki recall/decide MCP to render principle-relevant context (e.g. "the coworker recommends X because principle Y"), the projection service is the right place to enforce `principleRingScope`. The loader exposes:

```ts
async function loadPrincipleContextForSlot(input: {
  archetypeContext: string;
  capabilityName: string;
}): Promise<PrincipleRecallResult[]>;
```

…which internally sets `ringScope: ["ring-1-coworker", "ring-2-workflow", "ring-3-archetype"]` on the underlying `principle_recall` MCP call. The worker home **must not** be able to render `universal-ring` or platform-engineering principles. This is the substrate firewall between in-trench worker copy and platform-operator copy.

## 9. Design Research

### 9.1 Existing substrate (verified before this spec)

- **GearInterface model and writer** — `packages/db/prisma/schema.prisma` line 9832; writer at `apps/web/lib/gear-interface/writer.ts`. Query helpers at `apps/web/lib/gear-interface/query.ts` including `listRecentGearInterfaceRows`, `getGearInterfaceRowById`.
- **Calibrator** — `apps/web/lib/gear-interface/calibrator/`. `getTrustForTriple(triple, options?) → TrustReading` per index.ts. Trust readings carry `score, sampleSize, recentFailures, humanGraded, threshold`.
- **Governor** — `apps/web/lib/gear-interface/governor/`. `consult(input) → {verdict, ...}` per `governor.test.ts`. Verdict enum matches the parent spec.
- **CoworkerActionEnvelope** — `packages/db/prisma/schema.prisma` line 3895. `status: "proposed" | …`. The PAR (Propose-Acknowledge-Reassign) handoff queue's underlying record; the projection service reads from here to compose the coworker-handoffs slot signals.
- **DecisionInteraction** — referenced by BI-861C4959 sign-off as the audit record for Governor verdicts. The projection service joins Governor verdicts to the originating DecisionInteraction to derive `actionHref`.
- **CommunicationDeliveryAttempt** — line 4282; downstream archetype contributions (Dale's "Customer updates" slot) read from this. The projection service includes a translator for `status = "failed"` deliveries into a `slipReason = failed-outcome`-style signal so the customer-updates slot doesn't need a parallel projection.

### 9.2 Industry / pattern references

The translation pattern (raw telemetry → operator-vocabulary semantic events) is the same shape that:

- **Datadog / New Relic / Honeycomb** apply to APM traces — raw spans become "endpoint latency degraded" / "error rate spiked" alerts. Not "your `p99_latency_seconds` histogram bucket `5..10` is full."
- **GitHub Actions** applies to workflow runs — raw step exit codes become "deployment failed in step 3" workflow-run-failed notifications. Not raw `actions/run.json`.
- **Stripe Sigma** applies to webhook event streams — raw events become "subscription about to renew" / "card expiring" actionable digests.

The DPF pattern intentionally borrows that shape: GearInterface is the unbounded raw telemetry; the projection is the SRE-tier dashboard for workers. The parent spec §5.6's translation table is the small `mapTelemetryToSemanticEvent` function every observability stack ends up writing.

### 9.3 What this spec does NOT borrow

- Datadog-style **anomaly-detection ML over the signal stream**. The projection translates row-by-row; correlation / aggregation across rows happens in the Calibrator (which already does it) or at the renderer (deduping by capability). The translator stays pure and stateless.
- GitHub Actions-style **per-step icons that map directly to internal step names**. The parent spec forbids tool-name leakage. Worker-home labels are vocabulary, not implementation.
- Stripe Sigma-style **per-row drill-out to raw event JSON**. Drill-out is admin/Cockpit territory (BI-19D40BE7 surface). The worker home never exposes the raw row.

## 10. Verification strategy

### 10.1 Static

- **Banned-import test**: no `.tsx` under `apps/web/components/workspace-home/` imports from `apps/web/lib/gear-interface/`. Asserts the boundary.
- **Banned-copy test**: render each of 100 fixture translations through `translate…Projection`; assert the union output matches no banned-token regex.
- **TypeScript typecheck**: every signal source variant has its corresponding `translate…Projection` exported.

### 10.2 Per-translator unit

- **GearInterface translator**: one fixture per row of §5.1 translation table. Each fixture carries a representative `archetypeContext` and asserts the translated `WorkspaceHomeSignal` matches the table row.
- **Calibrator translator**: fixture inputs for the two threshold-crossing cases + a sub-threshold case that should NOT surface.
- **Governor translator**: fixture inputs for each verdict in §5.3. The `allow-auto silent` case must produce no signal (assertion: function returns `null`).

### 10.3 Integration

- **`loadWorkspaceHomeSignals` against seeded GearInterface + DecisionInteraction rows**: fixture for HVAC with 1 graduation, 1 veto, 1 failed-outcome, 1 capability-gap, 1 require-hitl, 1 escalate. Assert the returned signal array contains exactly 6 rows with correct sources, severities, and labels.
- **Archetype-scoping**: same fixture but seed an additional 5 rows with a different `archetypeContext` (e.g. `managed-service-provider`). Assert those 5 rows do NOT appear in the HVAC contribution's signals.
- **Ring-scope MCP recall**: mock the `principle_recall` MCP and assert `loadPrincipleContextForSlot` calls it with `ringScope: ["ring-1-coworker", "ring-2-workflow", "ring-3-archetype"]` and not `["universal-ring"]`.

### 10.4 Functional on Live portal

When the first vertical contribution (BI-CE6AF925 HVAC) lands and Phase 11 of the Dale plan runs, the projection service is verified end-to-end by rendering the HVAC home against the Phase 9 fixture. **No separate functional verification is required for this BI** — its functional verification is the union of all consuming contributions' verifications, exactly as the parent spec intends. Per `structural-verification-is-not-functional`, this BI ships with structural + unit + integration evidence; the contributions ship the functional evidence.

## 11. Open design questions — architect defaults

These need an architect decision before implementation starts; the plan-pass on this spec can override with evidence:

1. **Caching boundary.** The projection service is called on every `/workspace` render. Calling Calibrator and Governor synchronously per render at scale is expensive. **Default: no caching in v1.** Calibrator already maintains its own rolling window; Governor reads from in-memory thresholds. If render p95 exceeds 300ms at single-install scale, add a `lib/workspace-home/projections/cache.ts` with a per-request memoization shim (NOT cross-request — would mask state changes). Track via existing `dpf_workspace_home_resolutions_total` neighbor metrics.
2. **Severity assignment when Calibrator and GearInterface disagree.** A capability with `meanTorqueTechnical < 0.5` AND a recent graduation event creates contradictory signals. **Default: surface both; let the contribution decide which slot they go in.** Suppressing one risks fabrication; surfacing both gives the dispatcher the same situational ambiguity the underlying system has.
3. **Decision-interaction joining strategy.** Governor verdicts are written to `DecisionInteraction`. Joining at projection time means N+1 queries per verdict. **Default: batch-fetch DecisionInteraction by id-set after Governor verdict candidates are filtered.** Single query for the whole signal batch.
4. **PAR (Propose-Acknowledge-Reassign) handoff queue source.** The coworker-handoffs covenant slot needs PAR data. **Default: `CoworkerActionEnvelope WHERE status = "proposed" AND coworkerAgentId IN (this install's HVAC coworkers)` joined with Governor `require-hitl` decisions referencing the same threadId.** Confirm at implementation time that this captures the operator's PAR mental model end-to-end.

If the design-pass rejects any default, document the alternative + evidence in the PR that overrides this spec, then update §11 here in the same commit.

## 12. Implementation Implications

### 12.1 BI sequencing

This spec unblocks:

- **BI-CE6AF925** (HVAC dispatcher workspace home) — Phases 3-5 + 8 of [the HVAC plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md) all read through `loadWorkspaceHomeSignals` and the three `translate…Projection` functions.
- **BI-5B8FE5C1** (primitive registry) — the primitive specs at §6 in [that spec](2026-05-24-workspace-home-primitive-registry-design.md) reference the same `WorkspaceHomeSignal` shape for their data contracts. The primitive renderers consume the signals this service emits.
- **Future archetype contributions** (clinic, retail, MSP, training, ...) — all consume the same projection service through their contribution manifests; the vocabulary substitution happens at the `vocabulary.ts` layer per contribution.

The follow-on BI-3E8D2CF5 implementation can proceed independently of BI-CE6AF925; only the HVAC plan's Phase 0 dependency check blocks on it.

### 12.2 Build Studio routing

Per the standing override (`project_build_studio_non_functional_2026_05_26`), the projection-service implementation BI can be picked up by Claude under the BS-broken time-bounded waiver, the same pattern BI-861C4959 used. When BS returns, the canonical route is BI-3E8D2CF5 → BS Ideate → Design → Build → Ship with this spec as the design input.

### 12.3 Substrate boundaries unchanged

This spec does not propose schema changes, does not add new tables, does not change the substrate `WorkspaceHomeContribution` / `WorkspaceHomeRegistry` types from BI-1CCC6264, and does not change the parent spec's `WorkspaceHomeSignal` discriminated union. Everything new lives under `apps/web/lib/workspace-home/projections/`.

### 12.4 Test isolation

The translator functions are pure — they take a seed, return a signal (or null). They have no `prisma`, no MCP, no I/O. This is intentional: per-archetype tests that exercise the vocabulary substitution should run in milliseconds against synthetic seeds, not against a real Postgres or an emulated MCP. Integration tests (per §10.3) verify the wiring; unit tests verify the translation.

## 13. Standing rules audit

- **Mirror, don't migrate.** New module; no existing module renamed or moved. Calibrator and Governor (BI-861C4959) keep their current shape and call surface.
- **Schema honesty.** Types named for what they hold — `GearInterfaceProjectionSeed` is exactly the fields the GearInterface translator needs, no more. The shim is named `archetype-scope.ts` because that's what it scopes.
- **Make silent failures observable.** Vocabulary-gap fallbacks log `[projection-vocabulary-gap]`. Banned-token violations short-circuit the row (no silent emission with bad copy). Banned-import lint surfaces UI components that bypass the projection.
- **Consult specs first.** Parent §5.6, §5.7, §10; BI-861C4959 deliverable specs §6, §6.2, §6.4; primitive registry spec §6. All cited.
- **Verify substrate before proposing new.** GearInterface, Calibrator, Governor, CoworkerActionEnvelope, DecisionInteraction, CommunicationDeliveryAttempt all grep-verified on main before being cited.
- **Architecture over shortcuts.** Translator is pure, projection is one place, archetype-scope is the loader's first filter, ring-scope is enforced at the recall boundary. The substrate firewall between worker copy and platform copy is the spec's central architectural commitment.

## 14. What's explicitly NOT in this spec

- **Implementation of the projection service.** Plan + code in follow-on PRs.
- **Per-archetype vocabulary substitution tables.** Each contribution ships its own (parent §6.1 HVAC example is the template).
- **Schema for `CalibratorTrustSnapshot` / `GovernorDecision` Prisma models** — neither exists nor is needed; trust readings and verdicts are computed on demand from GearInterface rows + DecisionInteraction.
- **The Cockpit's diagnostic surface.** That's BI-19D40BE7 territory; the projection service intentionally does NOT translate for the operator audience.
- **External-counterparty signal projection** (`interfaceClass = external-*` in GearInterface). Worker home v1 reads only `internal-adjacent` rows; cross-install / federated projection is a future spec.

## 15. Definition of done

This spec is "done" when:

1. Operator review accepts (or rejects with revisions) the §11 design defaults.
2. A follow-on implementation plan ([dpf-writing-plans](../plans/) or equivalent) is filed against BI-3E8D2CF5 referencing this spec.
3. BI-CE6AF925's [HVAC implementation plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md) Phase 0 check passes — i.e. `apps/web/lib/workspace-home/projections/` exists with at minimum `loadWorkspaceHomeSignals`, the three `translate…Projection` functions, and the §10.1 banned-import test.

Spec done is not implementation done. The plan-pass picks up the §6 archetype-scope path A/B verification at the moment of implementation.
