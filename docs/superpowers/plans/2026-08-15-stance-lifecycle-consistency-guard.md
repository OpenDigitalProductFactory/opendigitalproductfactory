# Plan — Stance ↔ Lifecycle Consistency Guard, slices S1 + S2 (BI-EAD441E0)

**BI:** BI-EAD441E0 · **Epic:** EP-1C37C089 · **Priority:** P1 · **Triage:** build/xlarge
**Spec:** [2026-08-15-stance-lifecycle-consistency-guard-design.md](../specs/2026-08-15-stance-lifecycle-consistency-guard-design.md)

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Scope

This plan implements **S1 (coupling model + pure negation analyzer)** and **S2 (CI structural guard)** — the detection half plus the fleet-propagated block. **S3 (per-install runtime governance routing)** is filed separately as **BI-696B91AB** so it lands with the EP-1C37C089 gate (spec-stage today) rather than inventing a parallel governance path.

## Phases

### Phase 1 — Coupling model + negation analyzer (S1)
**Deliverable:** `apps/web/lib/lifecycle/grammar-negation.ts`
- `LifecycleDependency = { grammar, stage, state? }`; `parseLifecycleDependencies(metadata)` reads the declared deps off a stance page's existing `WikiPage.metadata` JSON (`lifecycleDependencies`) — tolerant of missing/malformed shapes (returns `[]`, never throws).
- `buildGrammarSnapshot(registry)` → the flat set of `{grammar, stage, state}` keys plus the semantic fields that matter (`label`, `band`, `exitCriteria`) for re-semanticization detection. Pure, derived from `LIFECYCLE_GRAMMARS`.
- `analyzeGrammarNegation(previous, current, stanceDeps)` → per-stance findings `{ slug, dependency, delta: "removed"|"resemanticized", severity: "negating"|"weakening", detail }`.
- `resolveDependency(registry, dep)` → whether a declared dep resolves today (the queryable half of AC-1).

**Verify:** unit tests — dep parsing (valid / absent / malformed), snapshot derivation, removed stage → negating, removed state → negating, renamed key → negating (removal of old key), label/band change on a depended element → weakening, unrelated change → no finding, addition → no finding.

### Phase 2 — CI structural guard + snapshot baseline (S2)
**Deliverable:**
- `apps/web/lib/ux-budget`-style committed baseline: `apps/web/lib/lifecycle/lifecycle-grammar-snapshot.json` (the frozen previous snapshot) + `scripts/check-lifecycle-stance-consistency.mjs`.
- The guard rebuilds the current snapshot, diffs vs the baseline, resolves stance dependencies from the **repo-declared** stance corpus (seeded org stance pages) and reports: `negating` → **exit 1 (block)** naming stance + broken dependency + the remedy (update the stance, or `--update` the baseline with an explicit operator call-out); `weakening` → warn; clean → pass with counts.
- **Fails loud:** if the registry cannot load or the baseline is missing/corrupt, the guard exits non-zero with the exact fix — it never passes silently.
- Wire into the repo guard loop (Policy Guards (source)) alongside the sibling ratchets.

**Verify:** guard unit test over synthetic grammars/stances: gutting the `retain`-analogue stage while a stance depends on it is CAUGHT and blocks (the BI's named regression); a baselined, unchanged corpus passes; a missing baseline fails loud. Functional: run the guard against the real repo corpus — must pass clean on an unchanged tree, and block on a deliberately mutated grammar.

## Backlog coverage

- **Decision:** `decomposed` · **Receipt:** `cmsuopg0k1o6f01ppu8oix04h` (recorded 2026-08-15; mapped: BI-EAD441E0, BI-696B91AB)
- `s1-coupling-analyzer` → **BI-EAD441E0** (independently shippable)
- `s2-ci-structural-guard` → **BI-EAD441E0** (depends on `s1-coupling-analyzer`)
- `s3-runtime-governance-routing` → **BI-696B91AB** (depends on `s1-coupling-analyzer`; sequenced after the EP-1C37C089 gate is built)

**Implementation status (2026-08-15): NOT STARTED.** This plan and its spec are captured design only — no code has been written for S1 or S2. The next session picks up at Phase 1.

## Risks & rollback

- **False block** on a legitimate structural change → mitigated: the baseline is explicitly updatable (`--update`) with the change called out in the PR description, same ergonomics as the other repo ratchets; `weakening` only warns.
- **Under-detection** of free-text stances that imply a dependency without declaring one → accepted and documented: declaring the dependency is what makes negation detectable rather than guessed; semantic drift stays with the WWWD gate.
- **Blast radius:** a new CI guard + one pure module. No schema change, no runtime write path, no migration.
- **Rollback:** remove the guard from the loop (the analyzer is inert unless invoked); delete the baseline. Nothing to un-migrate.

## Definition of done

- [ ] Stances can declare/resolve a dependency on grammar elements; dependency is queryable.
- [ ] Removing/renaming/re-semanticizing runs a negation-impact pass listing affected stances BEFORE apply.
- [ ] A negating structural change is blocked with a receipt/remedy — never silently applied.
- [ ] The guard ships in source, so it reaches every instance via the self-upgrade path (BI-D4C1E05E mechanism).
- [ ] The check fails loudly when it cannot evaluate.
- [ ] Regression: gutting the `retain` stage while the recurring-use stance depends on it is caught, not silently applied.
