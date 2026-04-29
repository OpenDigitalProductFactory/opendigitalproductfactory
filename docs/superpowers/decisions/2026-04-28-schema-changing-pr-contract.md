# Decision Record: Interim Contract for Schema-Changing PRs

| Field | Value |
|-------|-------|
| **ID** | DR-2026-04-28-01 |
| **Plan item** | A2 (Wave 1, Track A) of [2026-04-28 sequencing plan](../plans/2026-04-28-coworker-and-routing-sequencing-plan.md) |
| **Status** | Proposed |
| **Date** | 2026-04-28 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Format** | Nygard-classic ADR (Title / Context / Decision / Consequences / Alternatives) |
| **Sunset** | This decision is **interim**. It is superseded the moment Routing Phase A (B1 in the sequencing plan) ships and assumes the runtime substrate's publication-boundary responsibilities. |

---

## Context

PR #318 renamed `ModelProfile.capabilityTier` → `capabilityCategory`. The rename's migration auto-applies on three of six DPF deployment paths (production runner, sandbox, promoter) and **does not** auto-apply on the other three (dev container, host-dev, fresh CI runs). The audit at [2026-04-28-rename-318-drift-surfaces.md](../audits/2026-04-28-rename-318-drift-surfaces.md) found:

- A `Parameters<typeof prisma.modelProfile.updateMany>[0]["data"]` cast in `reconcile-catalog-capabilities.ts` that suppressed the rename signal entirely. The catalog reconciler runs in `docker-entrypoint.sh` step 3b on every container start and writes the old field name through that cast.
- Six adapter-layer struct sites that read the new column name and immediately rename it back to the old name in memory.
- The boot-invariant audit's INV-6b scans only `apps/web/lib/routing/`, missing all the §3.2 sites.
- The user-observed symptom: `column "ModelProfile.capabilityCategory" does not exist` when starting a marketing strategy session — produced by an unmigrated DB in the dev path.

The sequencing plan ([§3.1](../plans/2026-04-28-coworker-and-routing-sequencing-plan.md)) defers the *structural* fix to B1 (Routing Phase A): the publication-boundary substrate that makes schema changes either atomically applied or atomically loud, so this class of drift becomes structurally impossible.

But B1 does not exist yet. A2 is the contract that contains the same failure class until B1 lands. Without it, the next schema-changing PR will reproduce #318's failure mode.

A2 is not a substrate. It is a discipline document that schema-touching PRs must satisfy.

## Scope

This contract applies to any PR that:

- Modifies `packages/db/prisma/schema.prisma` (any change to a model definition, field name, type, default, or constraint).
- Adds a file under `packages/db/prisma/migrations/`.
- Modifies any `*.prisma` file.

It does **not** apply to:

- Pure data-only changes (e.g., editing `packages/db/data/*.json` seed values) that don't touch schema.
- Documentation-only PRs (this PR is one).
- PRs that touch only `agent_registry.json`, `grant_catalog.json`, or other non-schema JSON.

## Decision

A schema-changing PR (per Scope) **MUST** satisfy all five rules below. CI does not yet enforce these — they are author-and-reviewer discipline until B1 ships an automated equivalent.

### Rule 1 — Dev-container migration parity

The dev container CMD ([`Dockerfile:11`](../../../Dockerfile)) MUST run `prisma migrate deploy` before starting the app, matching what the production runner already does in [`docker-entrypoint.sh:6-24`](../../../docker-entrypoint.sh).

The dev CMD is currently:

```sh
pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev
```

The contract requires it to become (logically):

```sh
pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter @dpf/db exec prisma migrate deploy && pnpm --filter web dev
```

**This is the only code change A2 prescribes** — and even this change does not ship in this decision PR. It ships in the *next* schema-changing PR as part of that PR's compliance with this contract. The reason: shipping it now would itself be a small infrastructure change that warrants its own review window. Tying it to a real schema PR makes the change purposeful and gives it a runtime test (the schema PR's own migration is the test fixture).

For host-dev (`pnpm dev` against host DB), the contract has no automatable answer — host environments vary. The PR description **MUST** include the command the developer ran to verify migrations applied locally:

```
pnpm --filter @dpf/db exec prisma migrate deploy
```

### Rule 2 — Whole-codebase old-name sweep

For any field rename, the PR author MUST run a literal-string grep for the old name across the entire repo (not just `apps/web/lib/routing/`):

```sh
git grep -n "<old_field_name>" -- ':(exclude)docs' ':(exclude)*.md'
```

Every match MUST be one of:

- (a) **Renamed** to the new field name, or
- (b) **Documented** in the PR description as a deliberate non-rename, with the reason — typically because the symbol refers to a *different* concept that happens to share the name (e.g., `ModelProvider.capabilityTier` survived #318 because it is a different concept).

The PR description MUST contain a section named "Old-name sweep" listing each remaining match and its category (renamed / kept-with-reason).

### Rule 3 — Internal struct field-name parity

If a Prisma field is renamed, every internal TypeScript type that mirrors that field MUST be renamed in lockstep, unless the PR description explicitly identifies a translation layer and justifies it. The §3.2 sites in the A1 audit (`ai-provider-priority.ts:99`, `ai-provider-types.ts:76`, etc.) are the negative example: they read the new name from the DB and immediately rebind it to the old name in memory, with no translation layer named or motivated.

This rule is a softer form of Rule 2 — Rule 2 finds the references; Rule 3 says "if it's an internal struct mirroring a Prisma field, the default is rename, not keep."

### Rule 4 — No type-cast suppression of Prisma input signals

Schema-changing PRs MUST NOT introduce or preserve `as Parameters<typeof prisma.<Model>.<method>>[<index>]["data"]` casts on the `data` argument of `prisma.<Model>.{create,update,updateMany,upsert,createMany}`. If such a cast already exists in code the PR touches, the PR either:

- (a) **Removes the cast** and addresses the type error that surfaces, or
- (b) **Documents in the PR description** why the cast is unavoidable, with a citation of the legitimate type-system limitation that requires it.

Memory `feedback_check_tool_signals.md`: don't blame the model; check tool return values. The cast is a tool signal that the rename is incomplete. Banning the suppression is the contract that prevents PR #318's smoking gun from recurring.

### Rule 5 — Smoke verification in PR description

The PR author MUST run the following sequence against an empty database before opening the PR, and include the output (or "no errors") in the PR description:

```sh
# 1. Apply all migrations including the new one
pnpm --filter @dpf/db exec prisma migrate deploy

# 2. Type-check the whole web package against the post-migration schema
pnpm --filter web exec tsc --noEmit
```

This is the smallest evidence that the PR's schema and code are mutually consistent. CI may eventually run this; until then, the PR author runs it.

The smoke test does NOT exercise runtime read paths — that's deferred to a future hygiene PR (a rename-aware integration test). What this rule catches is the type-level mismatch the §3.2 fictions hide.

## Consequences

### Positive

- The catalog-reconciler smoking-gun cannot recur: Rule 4 forbids the cast; Rule 5 surfaces the type error.
- The dev-container drift gap closes structurally: Rule 1 brings the dev path in line with production.
- Whole-codebase vocabulary drift becomes visible: Rule 2 documents every match; Rule 3 sets a default.
- Adapter-layer fictions become explicit: Rule 3 either renames them or names the translation layer.
- The contract is small and PR-author-checkable. No CI infrastructure required for v1.

### Negative

- Five rules per schema PR is friction. Schema PRs become non-trivial to author. This is the intended cost — schema is shared substrate, and the cost of breaking it is higher than the cost of careful authorship.
- Rule 2's grep can be noisy on common short names (`status`, `type`). The PR author judges relevance. This is tolerable while volume is low; if it becomes a problem, B1 owns a structural answer.
- Rule 4's prohibition on `Parameters<...>` casts may catch legitimate composition patterns. The "document the exception" escape valve handles those.

### Neutral

- Rule 1's dev-container change ships with the *next* schema PR, not this one. That defers the change's blast-radius review until there's an actual schema migration to test it against. If no schema PR comes for a long time, the dev-path drift remains — but the marketing-coworker error is the only known live symptom, so there is no urgency without a real migration to motivate the change.

## Alternatives Considered

### A. Add `prisma migrate deploy` to the dev container immediately

**Rejected.** Doing this now without an actual schema PR to verify it means the change ships untested against a real migration. Bundling it with the next schema PR makes the change purposeful and gives it a real test fixture. Memory `feedback_no_mass_bash.md` and `feedback_proper_fix_over_quick_fix.md` both argue against blast-radius changes without a test path.

### B. Build a CI rename-detection job now

**Rejected.** A CI job that scans for renamed fields and verifies the old name doesn't survive would be valuable, but authoring it requires either (a) a hand-maintained list of renames per release, or (b) introspecting Prisma migration history to derive the rename automatically. Both are PRs of their own. A2's job is the contract, not the enforcement substrate. B1 (Routing Phase A) is the substrate — let it decide whether the enforcement looks like CI grep or like a runtime publication-boundary check.

### C. Ban schema renames entirely until B1 ships

**Rejected.** This would block real refactoring work whose only sin is sharing a type-system class with the rename that produced #318's drift. Memory `feedback_zero_technical_debt.md`: clean naming matters. The contract enables careful renames; banning them creates worse debt.

### D. Make the contract ship-or-revert: a schema PR ships with the rule-1 CMD change too

**Rejected.** Same reason as A — bundling without a test fixture. The CMD change deserves a real migration to test against, which the next schema PR will provide.

### E. Use the MADR (Markdown ADR) format with a deciders table and options-evaluation matrix

**Rejected.** MADR is right-sized for cross-team architectural decisions with multiple stakeholders weighing trade-offs. A2 is a single-author interim contract on a tight scope. Nygard-classic (this format) is right-sized; MADR would be ceremony.

## Open questions for Mark

These do not block the contract's adoption, but answers improve it:

1. **Rule 1 sequencing.** Confirm: the dev-container CMD change ships with the next schema PR, not this one. Or: the contract ships the change immediately if you'd rather have the parity now and accept the blast-radius risk.
2. **Rule 4 escape valve.** "Document the exception" is the current phrasing. Is that enough, or should an exception require a code comment AND a PR-description note? Default assumed: PR description only is fine for v1.
3. **Sunset trigger.** This decision sunsets when B1 lands — but "B1 lands" is not yet defined precisely. Default assumed: when the routing spec's Phase A (RIB introduction) is in production with the publication boundary serving real traffic, this contract retires and B1's substrate takes over the rename-safety responsibility.

## Status

**Proposed.** Will become **Accepted** when this PR merges, and **Superseded** when B1 sunsets it.
