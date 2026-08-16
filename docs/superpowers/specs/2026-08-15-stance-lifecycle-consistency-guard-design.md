---
title: "Stance ↔ Lifecycle Consistency Guard — structural changes governed against the stances they would negate"
date: 2026-08-15
bi: BI-EAD441E0
epic: EP-1C37C089
status: draft
---

# Stance ↔ Lifecycle Consistency Guard (BI-EAD441E0)

## Owner principle

Lifecycle structure (the stage/state grammar, BI-E55991E9) and the governance stances (WWWD corpus) are **coupled and must not drift out of sync — on any instance, ever**. A structural change that would NEGATE a governing stance (e.g. gutting the OVSM `retain` stage while the stance "continued/recurring use is the goal" depends on it) must be **detected and routed through governance** — surfaced, reconciled, or blocked — never silently applied.

## Why this is buildable now

| Dependency | State |
| --- | --- |
| BI-E55991E9 — canonical lifecycle grammar | **Merged** (#4289). Grammars are declared *data* (`LIFECYCLE_GRAMMARS: Record<string, LifecycleGrammar>`), with stable `stage.key` / `state.key` — diffable. |
| BI-D4C1E05E — stance embedding + upgrade self-heal | **Merged** (#4296). Stances are now actually retrievable, so "evaluate a stance" is no longer a silent empty read. |
| EP-1C37C089 — governance gate on consequential tool use | **Spec stage** — the tool-use middleware is NOT built. This guard therefore defines its own detection + routing seam and stays composable with that gate when it lands. |

## Design

### 1. Coupling model — a stance declares what it depends on

A stance page declares its dependency on grammar elements in the existing free-form `WikiPage.metadata` JSON column (already plumbed end-to-end through `saveWikiOverlayEdit`). **No new Prisma model, no migration.**

```jsonc
// WikiPage.metadata
{
  "lifecycleDependencies": [
    { "grammar": "customer-account", "stage": "active", "state": "at_risk" },  // state optional
    { "grammar": "opportunity", "stage": "closed_won" }
  ]
}
```

Resolution rules:
- A dependency is **resolvable** when `grammar`, `stage` (and `state`, when given) exist in the live registry.
- A dependency that no longer resolves is exactly a **negation candidate**.
- Free-text stances with no declared dependency are out of scope for *structural* detection (they remain covered by the semantic WWWD gate). Declaring the dependency is what makes negation **detectable rather than guessed** — the BI's explicit requirement.

### 2. Negation-impact analysis — diff two grammar snapshots

A **grammar snapshot** is the set of `{grammar, stage, state}` keys derivable from `LIFECYCLE_GRAMMARS` (pure, no I/O). Comparing a *previous* snapshot to the *current* one yields structural deltas:

| Delta | Meaning | Severity |
| --- | --- | --- |
| stage/state key **removed** | the element a stance depends on is gone | **negating** |
| stage/state key **renamed** (removed + added) | detected as a removal against the old key | **negating** |
| `label` / `band` / `exitCriteria` changed on a depended-on element | **re-semanticized** — same key, different meaning | **weakening** |
| element added, or change to an undepended element | no stance impact | informational |

`analyzeGrammarNegation(previous, current, stanceDeps)` returns, for each affected stance: the stance slug, the dependency that broke, the delta kind, and the severity. Pure function → fully unit-testable, no DB.

### 3. Governance routing — surface / reconcile / block, with a receipt

The analysis runs as a **guard**, and its verdict routes:

- **`negating` findings → BLOCK** with a named receipt: the change is refused until either the stance is updated (reconcile) or the operator explicitly accepts the negation. This is the "never silently applied" requirement.
- **`weakening` findings → SURFACE** (warn + receipt) — the operator sees what shifted without a hard stop.
- **Clean → pass**, reporting counts as data.

**Self-verifying / fails loud:** if the guard cannot evaluate — the grammar registry fails to load, or the stance corpus cannot be read — it FAILS rather than passing silently (the BI's explicit requirement, and the same non-silent discipline as BI-D4C1E05E's embed seam and the reembed reconcile).

### 4. Fleet propagation — where the guard runs

Two surfaces, one implementation:

1. **Repo/CI guard (ships the structural premise fleet-wide).** The declared grammars live in source, so a stance-negating *design* change is caught in CI against a committed snapshot baseline (`lifecycle-grammar-snapshot.json`), the same ratchet shape the repo already uses (`check-no-private-identity`, module-size). This is how the guard itself, and every structural change, propagates to every instance through the normal PR → upstream `main` → self-upgrade path established in BI-D4C1E05E.
2. **Per-install runtime check (guards each install's OWN stance corpus).** The same pure analyzer runs against the install's live stance metadata, so an install's per-org stances are checked against the structural change it receives on upgrade — the BI's "runs LOCALLY on each install" requirement.

## Slices (each independently shippable)

| Slice | Deliverable | Ships alone? |
| --- | --- | --- |
| **S1 — coupling + analyzer** | `lifecycleDependencies` metadata contract, snapshot builder, `analyzeGrammarNegation` (pure), unit tests | **Yes** — makes dependencies declarable + queryable and negation computable (BI ACs 1–2) |
| **S2 — CI structural guard** | snapshot baseline + `check-lifecycle-stance-consistency.mjs` wired into the guard loop; blocks a negating change pre-merge | **Yes** — needs only S1 |
| **S3 — runtime governance routing** | per-install evaluation over live stance metadata + governance receipt/surface; composes EP-1C37C089's gate when built | **Yes** — needs S1 |

S1 is the foundation; S2 and S3 are independent consumers of it. **This spec's implementation starts with S1 + S2** (the detection + fleet-propagated block, which is the load-bearing half); S3 is filed as follow-on work so the runtime routing lands with the EP-1C37C089 gate rather than inventing a parallel one.

## Acceptance mapping (BI-EAD441E0)

- Stances declare/resolve a dependency on grammar elements; queryable → **S1**
- Removing/renaming/re-semanticizing runs a negation-impact pass listing affected stances BEFORE apply → **S1 + S2**
- Negating change routed through governance (surface/reconcile/block) with a receipt, never silent → **S2** (block + receipt) and **S3** (runtime routing)
- Guard present + runs on every instance post-upgrade → **S2** ships the premise in source via the self-upgrade path; **S3** the per-install run
- Self-verifying, fails loud when it cannot evaluate → **S1/S2**
- Regression: gutting OVSM `retain` while the recurring-use stance depends on it is caught → **S2** test
