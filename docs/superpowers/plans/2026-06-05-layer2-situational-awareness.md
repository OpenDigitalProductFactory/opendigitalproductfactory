# Plan — Layer 2 Situational-Aware Decision Weighting

- **BI:** `BI-E1267C6D` (acceptance criteria = this plan's definition of done)
- **Design:** [`docs/superpowers/specs/2026-06-05-layer2-situational-awareness-design.md`](../specs/2026-06-05-layer2-situational-awareness-design.md) (operator-reviewed)
- **Date:** 2026-06-05
- **Approach decision:** retrieval-fix path (design §3 recommended) — situational rules ship as `contextual`. If the operator picks the commandment-tier shortcut instead, **skip Phase 1** and author the principles as `commandment` in Phase 3.

## Ordering constraint

Phase 1 (retrieval fix) is a hard prerequisite for Phases 3–4 on the recommended path: situational principles are `contextual`, and they only contribute structured signal once `core`/`contextual` vectors load. Phase 2 (dimensions) is independent and can land first.

---

## Phase 1 — Load core/contextual structured vectors (the retrieval fix)

**Deliverable:** `principle_decide` scores `core`/`contextual` principles with their signed `principleDimensionVector` (structured), not all-zero semantic.

**Files (verified):**
- `apps/web/lib/mcp-tools.ts` — the `principle_decide` handler, candidate-row build at ~12446–12456 where Qdrant hits get `dimensionVector: {}`. After the Qdrant relevance search returns `pageId`s for core/contextual, **batch-fetch those pages' `principleDimensionVector` from Postgres** (by id) and populate the candidate vector. Keeps Qdrant for relevance ranking, PG for the signed vector — surgical, no Qdrant re-index.
- `apps/web/lib/mcp-tools-principle-decide.test.ts` — add a case asserting a core principle with a vector contributes structured (non-zero), not semantic-0.

**Verification (functional):** live `principle_decide` on the Layer-1 quick-vs-proper scenario now shows `fix-the-seed`/`research-before-implementing` contributing non-zero structured rows (today they are exactly 0.000). Engine back-test: core principles included with vectors.

---

## Phase 2 — Add 3 situational dimensions to the closed registry

**Deliverable:** `incident_severity`, `customer_impact_active`, `time_criticality` in `PRINCIPLE_DIMENSIONS`.

**Files (verified):**
- `packages/db/src/wiki-taxonomy.ts` — append to `PRINCIPLE_DIMENSIONS` (currently 14 axes, ~line 144).
- `packages/db/src/wiki-taxonomy.test.ts` — update any count/membership assertions.

**Verification:** typecheck; `pnpm --filter @dpf/db test` green; seed walker accepts vectors keyed on the new dims (it rejects unknown dims, so this is the gate).

---

## Phase 3 — Author the 4 new principles + augment 2 existing

**Deliverable:** situational + cost principles in the kernel, each scoping-validated.

**Files (verified authoring flow — docs/founder-kernel/AUTHORING.md §8A):**
- New under `docs/founder-kernel/wiki/principles/`: `restore-service-first-under-active-incident.md` `{incident_severity:1.0, public_safety:0.3}`, `minimize-active-customer-impact.md` `{customer_impact_active:1.0, public_safety:0.4}`, `respect-incident-time-pressure.md` `{time_criticality:1.0}`, `prefer-cost-effective-sound-solution.md` `{cost_efficiency:1.0}`. Tier `contextual` (recommended path). Ring scope: scope via recursive `principle_decide` (likely `universal-ring` for incident rules, since incidents can occur in any context).
- Augment `destructive-actions-require-explicit-go.md` and `human-in-the-loop-at-phase-boundaries.md` with a small `incident_severity`/`time_criticality` term — satisfies the ≥2-principles-per-dimension rule and lets those rules relax under a live incident.
- `packages/db/src/seed-wiki-kernel.ts` reseed; `mcp__dpf__wiki_lint` after.

**Verification:** seed + `wiki_lint` clean (no dangling-xref/public-safety/coherence blockers); recursive `principle_decide` scoping ledger captured in this plan/PR per AUTHORING §8A.172.

---

## Phase 4 — Golden incident scenario + re-bless baseline

**Deliverable:** the situational behavior is a corpus-aware CI gate.

**Files (verified):**
- `apps/web/lib/decision/golden-decisions.ts` — add `incident-prod-down` scenario (quick-restore vs proper-refactor, incident features set) → expected `quick-restore`; **widen `selectKernelCommandments`** to also include the now-structured situational/cost `contextual` principles (today it filters to commandment tier only).
- `apps/web/lib/decision/golden-decisions.baseline.json` — regenerate via `UPDATE_GOLDEN_BASELINE=1` after reviewing the deltas (core tier now contributes — expect broad numeric movement, winners must hold).

**Verification:** `golden-decisions.test.ts` green: NORMAL→proper, INCIDENT→quick-restore (margin > floor), GUARD→cheap-sound. CI Unit Tests + Typecheck green.

---

## Phase 5 — Live functional verification (deferred / gated)

Live `principle_decide` confirmation of the incident scenario requires the kernel reseeded into the running install — **gated on the self-upgrade path fix (`BI-4112378F`) + a fresh bundle from main**. Until then, the Phase-4 engine baseline is the gate. Track as a follow-up; do not block Layer 2 merge on it.

---

## Risks + rollback

| Risk | Blast radius | Mitigation / rollback |
|---|---|---|
| **Phase 1 broadens every decision** — core tier starts contributing; could flip an unrelated decision | all `principle_decide` calls | Re-run golden baseline + a spread of live `principle_decide` smokes before/after; winners must hold. Rollback = revert the candidate-vector fetch (one localized change). Consider a kill-switch env (`PRINCIPLE_DECIDE_STRUCTURED_CORE`) for staged rollout. |
| New dimensions unused/incoherent | seed-time | Seed walker rejects unknown dims and incoherent pairings — fails loud at seed, not runtime. Rollback = remove the dims (append-only). |
| Situational principle leaks into normal decisions | normal dev decisions | Keyed purely on situational dims → 0 when absent; the golden NORMAL scenario is the guard. Rollback = retire the .md + reseed. |
| Baseline re-bless hides a real regression | CI trust | Review the snapshot diff in the PR (winners + top contributors), not a blind regenerate; winner flips still hard-fail. |

## Definition of done (= BI-E1267C6D acceptance)

- Core/contextual principles contribute structured signal (Phase 1 functional check).
- 3 situational dimensions + 4 principles seeded, lint-clean, scoping ledgers captured.
- `golden-decisions.test.ts` gates NORMAL→proper, INCIDENT→quick-restore, GUARD→cheap-sound against the real corpus; CI green.
- Live verification tracked as a follow-up gated on `BI-4112378F`.
