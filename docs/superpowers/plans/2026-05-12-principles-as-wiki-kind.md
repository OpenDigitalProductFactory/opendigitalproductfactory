# Principles as a Wiki Kind - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Phase A is one PR; Phase B is an independent PR; do not bundle.

| Field | Value |
|-------|-------|
| **Spec** | [2026-05-12-principles-as-wiki-kind-design.md](../specs/2026-05-12-principles-as-wiki-kind-design.md) |
| **Spec PR** | [#518](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/518) |
| **Status** | Re-baselined 2026-05-15 — single-phase plan against the actual worktree state |
| **Created** | 2026-05-12 |
| **Re-baselined** | 2026-05-15 after chief-architect review |
| **Branch base for all phases** | `origin/main` per `feedback_worktree_base_origin_main.md` |
| **Backlog linkage** | REQUIRED before any PR opens — see Phase -1 below |

**Goal:** Land the remaining consumer-archetype axis on top of the already-shipped `principle` wiki kind, back-fill the 41 existing principle pages, add advisory decision support, wire retrieval and MCP, ship lint with coherence enforcement, deliver tier-first UI with consumer-archetype filter chips, and generate the Jekyll public-docs page. Separately, close the kernel-slug uniqueness gap.

**Architecture:** Spec [`2026-05-12-principles-as-wiki-kind-design.md`](../specs/2026-05-12-principles-as-wiki-kind-design.md) is the authority. This plan is the task breakdown.

**Tech Stack:** Prisma 7, Postgres, Qdrant (`nomic-embed-text`, 768-dim), Next.js (App Router) for portal UI, Jekyll/GitHub Pages for public docs, Vitest, TypeScript, MCP JSON-RPC at `/api/mcp/v1`.

---

## What This Plan Replaces

Previous revisions had seven sequential batches (Phase -1 through Phase 6) that assumed the worktree was at zero. Re-baseline against the actual worktree (2026-05-15) shows that Phases 0, 1, 3, and most of 4–5 are already shipped via prior PRs. The remaining work is a single Phase A. The legacy phase numbering is retired; do not reference it.

What's already on this branch and not in scope here:

- `WikiPageKind` includes `principle`; `wiki-taxonomy.ts` exports the tier/applies-to/dimension constants and predicates; `WikiPage` carries `principleTier`/`principleDirection`/`principleWeight`/`principleWeightRationale`/`principleDimensionVector`/`principleDimensions`/`principleAppliesTo`/`principlePublic`/`principlePublicRationale` with indexes on tier and public, via migration `20260513000000_add_principle_fields_to_wikipage`.
- `docs/founder-kernel/_templates/principle.template.md` exists.
- `docs/founder-kernel/wiki/principles/` has 41 published kernel principles covering Principles 1–9 from the AI-coworker doc, the AGENTS.md durable-governance promotions, and a first slice of reviewed memory promotions.
- `docs/founder-kernel/manifest.json` is `kernelVersion: 0.2.1`, `schemaVersion: 0.2.0`, `pageCount: 62`, `sourceCount: 11`.
- `docs/architecture/ai-coworker-development-principles.md` contains Principles 1–9 including Responsible Capacity Utilization.

If a future reader expects Phases 0/1/3/4/5 from the previous plan — look at git log on `packages/db/src/wiki-taxonomy.ts`, `packages/db/prisma/migrations/20260513000000_add_principle_fields_to_wikipage/`, and `docs/founder-kernel/wiki/principles/` to see where they actually shipped.

---

## Build Gate (per `AGENTS.md` section 5, applied at every PR)

All four must pass before opening any PR:

1. Unit tests — `pnpm --filter <pkg> exec vitest run` for affected files.
2. Production build — `pnpm --filter web build` with zero errors.
3. UX verification — exercise affected portal paths against the running Docker stack whenever UI changes ship.
4. Migration applies cleanly on a fresh DB — for the schema PR only; back-fill PR is data-only.

Plus, per memory feedback:

- `git commit -s` on every commit (DCO required since 2026-04-24 public flip).
- Positional path args to scope staging (`git add -- <path>`) so concurrent worktree sessions cannot sweep their staged files into your commit.
- Branch from `origin/main`, not local `main`.
- Run `git branch --show-current` before committing; abort if on `main` or detached.
- Use pinned `pnpm --filter ...` commands rather than `npx` or root `pnpm`.
- Run `pnpm --filter web exec vitest run` for the full web suite before pushing — pre-commit hook only runs typecheck.
- **Continuous overlap sweep** before EVERY push: `git fetch origin && git log origin/main --oneline -20` and `gh pr list --state open --search "principle wiki"`. Re-sweep before each push, not just at session start (per `feedback_continuous_overlap_check.md`).

---

## Refactor Budget

20 percent of every PR is reserved for cleanup, deletions, and consistency fixes per `feedback_zero_technical_debt.md`. Each PR description must name what was retired.

This plan has one explicit refactor item already carved out: Phase B closes the kernel-slug uniqueness gap as its own small PR rather than coupling it to principle work.

---

## Phase -1 — Implementation Preflight

**Branch:** same branch as Phase A.

**Objective:** Make sure the implementation base, spec, plan, backlog, and repo truth all agree before code changes begin.

- [ ] **Read `AGENTS.md`** in this worktree end-to-end before any commit. Confirm the active branch is not `main` or detached.
- [ ] **Verify worktree state:** `git status --short`. List unrelated changes in the PR notes and avoid touching them.
- [ ] **Query live planning state via DPF MCP:**
  - `mcp__dpf__search_specs_and_plans` for `principles wiki kind consumer archetype`.
  - `mcp__dpf__list_epics` for open epics touching wiki, TAK/GAID memory, MCP, or governance.
  - Record matches in the Phase A PR body per spec §1.2. Linking to an existing epic (likely `EP-TAK-3F9A21` or `EP-DOCS-6B9F2A`) is recommended but not strictly required; the PR title + body must always be self-sufficient for discoverability.
- [ ] **Sweep recent main + open PRs** per `feedback_pr_overlap_check_before_pushing.md` and `feedback_continuous_overlap_check.md`:
  - `git fetch origin && git log origin/main --oneline -30`.
  - `gh pr list --state open --limit 30 --search "wiki principle"`.
  - Record any overlap and adjust scope accordingly.
- [ ] **Re-confirm current code anchors are still where the spec says they are:**
  - `WikiPageKind` in `packages/db/src/wiki-taxonomy.ts`.
  - `WikiPage` `principle*` columns in `packages/db/prisma/schema.prisma`.
  - `searchWikiPages` in `apps/web/lib/wiki/embeddings.ts`.
  - `recallWikiContext` in `apps/web/lib/wiki/recall.ts`.
  - `wiki_query` in `apps/web/lib/mcp-tools.ts`.
  - `agent-grants.ts` mappings in `apps/web/lib/tak/agent-grants.ts`.
  - External MCP route at `apps/web/app/api/mcp/v1/route.ts`.

**Exit criteria:** the spec, plan, target branch, live backlog, and overlap sweep agree. PR description has the backlog ID. No surprise overlap.

---

## Phase A — Consumer-archetype axis, back-fill, retrieval, MCP, lint, UI, public docs

**Branch:** `feat/principles-consumer-archetypes-and-decision-support`

**Objective:** Land the remaining work from spec §15 Phase A as one coherent PR.

**Files to create:**

- `packages/db/prisma/migrations/<timestamp>_add_principle_consumer_archetype_to_wikipage/migration.sql`
- `apps/web/lib/wiki/principle-recall.ts` + `.test.ts`
- `apps/web/lib/wiki/principle-decide.ts` + `.test.ts`
- `apps/web/lib/wiki/lint/principle-detectors.ts` + `.test.ts` (if not already present from earlier work — check first)
- `apps/web/lib/wiki/lint/principle-public-safety.ts` + `.test.ts`
- `apps/web/lib/wiki/lint/principle-coherence.ts` + `.test.ts` (new detector from spec §8A.1 + §14)
- `apps/web/lib/mcp-tools-wiki-query.test.ts` (if not already present)
- `apps/web/lib/mcp-tools-principle-decide.test.ts`
- `scripts/generate-public-principles.mjs` + `.test.mjs`
- `docs/principles.md` (generated artifact, committed for Jekyll)

**Files to modify:**

- `packages/db/src/wiki-taxonomy.ts` — add consumer-archetype constants + predicates.
- `packages/db/src/wiki-taxonomy.test.ts` — extend.
- `packages/db/prisma/schema.prisma` — `WikiPage` model adds `principleConsumerArchetype` + `principleConsumerContexts` + index.
- `packages/db/src/wiki-store.ts` + test — pass-through CRUD.
- `packages/db/src/seed-wiki-kernel.ts` + test — parse new frontmatter keys; back-fill validation.
- `docs/founder-kernel/wiki/principles/*.md` (all 41 pages) — back-fill frontmatter.
- `docs/founder-kernel/_templates/principle.template.md` — add new fields.
- `docs/founder-kernel/SCHEMA.md` — document new fields and coherence matrix.
- `docs/founder-kernel/AUTHORING.md` — document new authoring rules.
- `docs/founder-kernel/manifest.json` — bump `schemaVersion` to `0.3.0` (minor — additive).
- `apps/web/lib/wiki/embeddings.ts` + test — Qdrant payload + `searchWikiPages` filters.
- `apps/web/lib/wiki/recall.ts` + test — wire `recallPrincipleContext`.
- `apps/web/lib/mcp-tools.ts` — extend `wiki_query` schema/handler; register `principle_decide`.
- `apps/web/lib/tak/agent-grants.ts` — map `principle_decide` to `registry_read` (provisional).
- `apps/web/app/api/mcp/v1/route.test.ts` — confirm visibility.
- `apps/web/components/wiki/WikiPageList.tsx` + test — tier-first grouping for `kind=principle` with CA filter chips.
- `apps/web/components/wiki/WikiPageViewer.tsx` + test — metadata panel including consumer archetype + contexts.
- `apps/web/components/wiki/WikiPageKindBadge.tsx` — already renders `principle`; verify only.
- `apps/web/app/(shell)/admin/wiki/lint/page.tsx` + test — principle finding filter chips, including coherence detector.
- `docs/superpowers/specs/2026-05-09-wiki-visual-navigation-design.md` — principle-aware passes per spec §13 + visual-nav §3.1 / §4 / §5 / §6.
- `AGENTS.md` — add the `wiki_query pageKind='principle'` discovery pointer **only after** external MCP visibility test passes.
- `docs/index.html`, `docs/README.md`, `docs/_config.yml` (if needed) — link to `/principles/`.
- Root `package.json` — `docs:principles` script entry.

### Task A.1 — Extend taxonomy constants

**Files:** `packages/db/src/wiki-taxonomy.ts`, `packages/db/src/wiki-taxonomy.test.ts`

- [ ] **Write failing tests:** `PRINCIPLE_CONSUMER_ARCHETYPES` length and order; `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES` includes `build-studio`; `isPrincipleConsumerArchetype` / `isPrincipleConsumerContextSlug` narrow correctly for valid and reject invalid values.
- [ ] **Run tests, verify they fail.**
- [ ] **Implement** the constants and predicates from spec §8A.
- [ ] **Run tests, verify they pass.**
- [ ] **Commit (signed):** `feat(db): add principle consumer-archetype taxonomy constants`.

### Task A.2 — Schema migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<timestamp>_add_principle_consumer_archetype_to_wikipage/migration.sql`, `packages/db/src/wiki-store.test.ts`

- [ ] **Write failing test** in `wiki-store.test.ts`: create a `WikiPage` with `pageKind: "principle"`, `principleConsumerArchetype: "ai-coworker-universal"`, `principleConsumerContexts: []`. Assert round-trip.
- [ ] **Run test, verify it fails.**
- [ ] **Modify `schema.prisma`** to add:

```prisma
  principleConsumerArchetype String?
  principleConsumerContexts  String[] @default([])

  @@index([principleConsumerArchetype])
```

- [ ] **Generate migration:** `pnpm --filter @dpf/db exec prisma migrate dev --name add-principle-consumer-archetype-to-wikipage --create-only`. Inspect SQL — additive `ALTER TABLE` only.
- [ ] **Apply migration:** `pnpm --filter @dpf/db exec prisma migrate dev`.
- [ ] **Regenerate client:** `pnpm --filter @dpf/db exec prisma generate`.
- [ ] **Run test, verify it passes.**
- [ ] **Run full DB workspace tests:** `pnpm --filter @dpf/db exec vitest run` — green.
- [ ] **Commit (signed):** `feat(db): add principleConsumerArchetype + principleConsumerContexts to WikiPage`.

### Task A.3 — Seed parsing + template + SCHEMA.md + AUTHORING.md

**Files:** `packages/db/src/seed-wiki-kernel.ts` + test, `docs/founder-kernel/_templates/principle.template.md`, `docs/founder-kernel/SCHEMA.md`, `docs/founder-kernel/AUTHORING.md`, `docs/founder-kernel/manifest.json`

- [ ] **Write failing test:** fixture principle markdown with `principleConsumerArchetype: route-domain-specific` + `principleConsumerContexts: [build-studio]` round-trips through seed.
- [ ] **Run test, verify it fails.**
- [ ] **Extend the seed walker** to parse the new frontmatter keys, validate via the predicates from Task A.1, reject `route-domain-specific` without ≥1 context with a clear error message (per `feedback_check_tool_signals.md` — no silent skips).
- [ ] **Write second failing test:** seed rejects a coherence-matrix violation (e.g., `principleConsumerArchetype: ai-coworker-universal` + `principleAppliesTo: [human]`) at seed time. (Belt-and-suspenders alongside lint, because lint runs after seed.)
- [ ] **Run test, verify it fails, then implement, then verify it passes.**
- [ ] **Update the principle template** to include `principleConsumerArchetype:` and `principleConsumerContexts:` frontmatter placeholders with the §8A coherence guidance as inline comments.
- [ ] **Update `SCHEMA.md`** — extend the principle section with the consumer-archetype taxonomy, contexts, and the §8A.1 coherence matrix table.
- [ ] **Update `AUTHORING.md`** — document the consumer-archetype authoring rule and back-fill expectations.
- [ ] **Bump `manifest.json`** `schemaVersion` to `0.3.0` (additive minor) and update `description` to mention consumer-archetype awareness.
- [ ] **Commit (signed):** `feat(db,docs): parse consumer-archetype frontmatter; update SCHEMA + AUTHORING + template`.

### Task A.4 — Back-fill the 41 existing principle pages

**Files:** `docs/founder-kernel/wiki/principles/*.md`

For each existing principle page, add `principleConsumerArchetype` (and `principleConsumerContexts` where applicable) per the §8A.1 coherence matrix. Suggested initial assignments (the implementer reviews each against the actual page body):

- `architecture-over-shortcuts`, `single-source-of-truth`, `live-state-over-seed-data`, `never-fabricate`, `research-and-use-standards`, `principal-convergence`, `trust-the-data-spine` → `universal` (humans + agents everywhere).
- `specialization-over-generalization`, `orchestrator-worker-pattern`, `structured-handoffs-not-conversation-history`, `diversity-of-thought`, `selective-memory-not-total-recall`, `tools-must-be-self-documenting`, `human-in-the-loop-at-phase-boundaries`, `fail-fast-explain-clearly`, `responsible-capacity-utilization` → `ai-coworker-universal`.
- `do-the-work-dont-task-the-operator`, `state-results-directly`, `contextualize-before-transforming` → `generalist` (COO/coordinator style).
- `test-in-the-portal-build`, `release-qa-plan`, `tool-evaluation-pipeline`, `schema-audit-before-features`, `db-fallback-explicit`, `no-hardcoded-colors`, `strongly-typed-string-enums`, `one-data-model` → `specialist` (specialist agent rules).
- `all-changes-land-via-pr`, `always-push-after-committing`, `branch-guard-before-implementation`, `build-gate-mandatory`, `dco-sign-off-required`, `mention-uncommitted-changes`, `worktree-per-session`, `keep-root-clone-as-merge-worktree`, `check-epic-overlap-before-creating`, `one-concern-per-pr`, `plan-before-install-paths`, `fix-the-seed-not-the-runtime`, `backlog-lives-in-postgresql`, `organization-canonical-identity`, `design-research-required` → review each: pure agent-procedural rules go `ai-coworker-universal`; rules that govern human operators too go `universal`.

For each page:

- [ ] **Add `principleConsumerArchetype:`** to frontmatter (required).
- [ ] **Add `principleConsumerContexts:`** when archetype is `route-domain-specific` (required when applicable).
- [ ] **Verify coherence** against §8A.1 — adjust either `principleAppliesTo` or `principleConsumerArchetype` if the seeded page violates the matrix.
- [ ] **Re-seed:** `pnpm --filter @dpf/db seed`. Seed must not error.
- [ ] **Commit (signed, batched logically):** e.g., `docs(principles): back-fill consumer-archetype on AI-coworker principles (PRs #566, #570)`, `docs(principles): back-fill consumer-archetype on AGENTS.md commandments (PRs #579, #590)`, `docs(principles): back-fill consumer-archetype on AGENTS.md core promotions (PR #589)`, `docs(principles): back-fill consumer-archetype on AGENTS.md contextual promotions (PR #592)`, `docs(principles): back-fill consumer-archetype on founder-kernel seed commandments (PR #565)`. One commit per logical group keyed to its source PR so reviewers can see provenance.

### Task A.5 — Qdrant payload extension

**Files:** `apps/web/lib/wiki/embeddings.ts`, `apps/web/lib/wiki/embeddings.test.ts`

- [ ] **Write failing test:** when a principle page is upserted to Qdrant, the payload includes `principleConsumerArchetype` and `principleConsumerContexts`. Non-principle pages omit both keys (absence, not null/false).
- [ ] **Run test, verify it fails.**
- [ ] **Modify the payload write helper** to include the new keys when `pageKind === "principle"`.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(wiki): include consumer-archetype keys in principle Qdrant payload`.

### Task A.6 — `searchWikiPages` filters

**Files:** `apps/web/lib/wiki/embeddings.ts`, `apps/web/lib/wiki/embeddings.test.ts`

- [ ] **Write failing test:** `searchWikiPages({ pageKind: "principle", principleTier: "commandment", principleAppliesTo: "external_coding_agent", principleConsumerArchetype: "route-domain-specific", principleConsumerContext: "build-studio", principlePublic: true })` returns only matching principles; array filters honor containment.
- [ ] **Run test, verify it fails.**
- [ ] **Extend** `searchWikiPages` to accept and forward the new optional filters. Keep existing API stable.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(wiki): principle filters in searchWikiPages`.

### Task A.7 — `recallPrincipleContext`

**Files:** `apps/web/lib/wiki/principle-recall.ts`, `apps/web/lib/wiki/principle-recall.test.ts`

Contract per spec §12.1: Postgres-first commandments (cap 10) for the calling population, then Qdrant relevance-ranked core (top 5) and contextual (above threshold 0.75). Filter by consumer archetype before tier weighting. Exclude `route-domain-specific` unless `consumerContext` matches. Format as a distinct `## Governance Principles` block. Graceful degrade when Qdrant is down — return commandments from Postgres.

Implement in test-first sub-tasks for each branch (commandments, Qdrant relevance, contextual threshold, consumer-archetype filtering, route-context gating, formatting, Qdrant-degraded path). One commit per sub-task or one final commit, implementer's choice.

- [ ] **Commit (signed):** `feat(wiki): recallPrincipleContext with consumer-archetype filtering`.

### Task A.8 — Wire principle recall into `recallWikiContext`

**Files:** `apps/web/lib/wiki/recall.ts`, `apps/web/lib/wiki/recall.test.ts`

- [ ] **Write failing test:** `recallWikiContext` returns the existing context plus a `principleContext` block; existing consumers see no regression in the non-principle path.
- [ ] **Run test, verify it fails.**
- [ ] **Modify `recallWikiContext`** to invoke `recallPrincipleContext` in parallel, default `callingPopulation` to `human` when not provided, pass route/domain context through when the caller supplies one.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(wiki): wire recallPrincipleContext into recallWikiContext`.

### Task A.9 — `wiki_query` MCP schema and handler

**Files:** `apps/web/lib/mcp-tools.ts`, `apps/web/lib/mcp-tools-wiki-query.test.ts`

- [ ] **Write failing test:** `wiki_query` accepts and forwards `tier`, `appliesTo`, `consumerArchetype`, `consumerContext`, `publicOnly`. For `pageKind: "principle"`, the response includes full principle metadata.
- [ ] **Run test, verify it fails.**
- [ ] **Extend** the input schema (ergonomic short names) and the handler (translate to `searchWikiPages` canonical args).
- [ ] **Backwards-compat test:** existing `wiki_query` calls without new fields return the same shape.
- [ ] **Commit (signed):** `feat(mcp): wiki_query principle filters + metadata`.

### Task A.10 — `principle_decide` advisory tool

**Files:** `apps/web/lib/wiki/principle-decide.ts` + test, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/mcp-tools-principle-decide.test.ts`

Per spec §11. Implement in test-first sub-tasks:

- [ ] `computeStructuredAlignment(option, principle)` — dot product normalized by sum of `abs(weights)`, missing dimensions skipped (treated as 0 on the option side) with coverage tracking.
- [ ] `computeSemanticAlignment(option, principle)` — embedding cosine fallback when `principleDimensionVector` is empty; mark contributions as `mode: "semantic"`.
- [ ] `computeComposite(options, principles)` + `pickRecommendation(composites, tieMargin)`.
- [ ] Assemble the contribution ledger (per-principle id/name/tier/weight/mode/alignmentByOption/contributionByOption/missingDimensions; org-overlay rows labeled per spec §11.6).
- [ ] Guardrails: low-confidence when margin < tie margin, `commandmentConflict` flag on strong negative top-option contribution, `structuredCoverage: "weak"` on >40% semantic fallback, empty-set path.
- [ ] Register `principle_decide` in `PLATFORM_TOOLS` (`executionMode: "immediate"`, `sideEffect: false`, `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`).
- [ ] Map to `registry_read` in `agent-grants.ts` (provisional — spec §11.5).
- [ ] Description: "Advisory only. Returns a scored recommendation across applicable principles with a contribution ledger. Does not execute the recommended option."
- [ ] **Commit (signed):** `feat(mcp): principle_decide advisory tool with contribution ledger`.

### Task A.11 — External MCP visibility test

**Files:** `apps/web/app/api/mcp/v1/route.test.ts`

- [ ] **Write failing test:** `tools/list` against `/api/mcp/v1` with a `registry_read` token returns extended `wiki_query` (new fields visible in input schema) and `principle_decide`. A token without `registry_read` does not see them.
- [ ] **Run test, verify it fails or passes** (the route already gates by scope; this test confirms the contract).
- [ ] **Patch any gaps.**
- [ ] **Commit (signed):** `test(mcp): external visibility for wiki_query principle filters and principle_decide`.

### Task A.12 — Lint detectors

**Files:** `apps/web/lib/wiki/lint/principle-detectors.ts` + test, `apps/web/lib/wiki/lint/principle-public-safety.ts` + test, `apps/web/lib/wiki/lint/principle-coherence.ts` + test, `apps/web/lib/wiki/lint/index.ts` + test, `apps/web/lib/wiki/lint/__fixtures__/...`

Implement the detectors from spec §14 that are not already shipped. The coherence detector (`principle-incoherent-archetype-applies-to`) is net-new per spec §8A.1. The public-safety detector is the highest-risk lint — see spec §14 row for what it must catch and what it must NOT catch.

Detectors that depend on Qdrant similarity (`principle-duplicate`, `principle-contradiction-review`) MUST degrade to no-op + info-level finding when Qdrant returns empty (cold start) per spec §12.1. Add a regression test that proves this.

- [ ] **One sub-task per detector, test-first.**
- [ ] **Register** all detectors in the lint orchestrator. Cross-page detectors (cap-exceeded) get the cross-page hook; per-page detectors get the per-page hook.
- [ ] **Run lint against the 41 existing principle pages** — must pass after Task A.4 back-fill. If any fail, fix the back-fill (do not loosen the lint).
- [ ] **Commit (signed):** `feat(wiki-lint): principle detectors including coherence + public-safety`.

### Task A.13 — Admin lint UI filter chips

**Files:** `apps/web/app/(shell)/admin/wiki/lint/page.tsx` + test

- [ ] **Write failing test:** the admin lint page accepts a `?findingKind=principle-*` URL param and shows a "Principles" chip group with one chip per principle finding kind, including the new coherence one. (Test invocation: `pnpm --filter web exec vitest run "app/(shell)/admin/wiki/lint/page.test.tsx"` — quotes required so PowerShell doesn't glob the parens.)
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the filter chips using DPF theme tokens; long finding-kind names must wrap.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(admin-wiki-lint): principle finding filter chips`.

### Task A.14 — Wiki UI: tier-first principle browser with CA filter chips

**Files:** `apps/web/components/wiki/WikiPageList.tsx` + test

Per spec §13.1 (re-baselined): default grouping is **tier-first** (Commandments → Core → Contextual). Consumer-archetype lives as a multi-select filter-chip group above the list. A sort toggle flips to CA-first when the user wants a route/domain audit.

- [ ] **Write failing test:** when the `kind=principle` filter is applied, default grouping is tier-first; the CA filter-chip group renders above the list with all five archetypes selectable; toggling the sort to CA-first reorders. Build Studio rows are sub-grouped under Route / Domain Specific > Build Studio.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** using DPF theme tokens, the canonical taxonomy constants for ordering and labels, and stable row heights with wrapping.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(wiki-ui): tier-first principle browser with consumer-archetype filter chips`.

### Task A.15 — `WikiPageViewer` principle metadata panel

**Files:** `apps/web/components/wiki/WikiPageViewer.tsx` + test

- [ ] **Write failing test:** principle detail page shows consumer-archetype chip, route/domain context chips, tier badge, applies-to chips, weight (defaulted from tier if `principleWeight` is null), source count, dimension-vector table, public/internal badge.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the metadata block; keep body markdown render path unchanged.
- [ ] **Run test, verify it passes.**
- [ ] **Commit (signed):** `feat(wiki-ui): principle metadata panel in WikiPageViewer`.

### Task A.16 — Decision breakdown view

**Files:** `apps/web/components/wiki/PrincipleDecideBreakdown.tsx` + test (or co-locate inside an existing decision-support panel)

Per spec §13.3. Surface the `principle_decide` contribution ledger inside Build Studio, coworker chat, or admin tooling.

- [ ] Recommendation first, then a compact contribution table.
- [ ] Horizontal contribution bar per option with positive/negative segments + text labels.
- [ ] Commandment conflicts shown via tokenized alert styling (no hardcoded red).
- [ ] Semantic-fallback warnings shown when option features are missing.
- [ ] No one-click "execute recommended action" button.
- [ ] Overlay-sourced contributions labeled per spec §11.6.
- [ ] **Commit (signed):** `feat(wiki-ui): principle_decide breakdown view`.

### Task A.17 — Visual-navigation spec refresh

**Files:** `docs/superpowers/specs/2026-05-09-wiki-visual-navigation-design.md`

Update the visual-nav spec for principle awareness across all tiers, not only the §5.1/§5.2 retrofit:

- §3.1 (Tier 1 sidebar): elevate `principle` pages above stance/heuristic in the relevant-rows ordering when they match scope.
- §4 (Tier 2 mini-graph): document principle node behavior and override-edge semantics for overlay principles.
- §5.3 (time-travel atlas): mention principle promotions and tier changes as the most interesting bi-temporal evolution to visualize.
- §6.1 (node shapes): assign a shape to `principle` so all eight `WikiPageKind` values have a defined glyph.
- §6.3 (state outlines): add the principle-specific lint states (`principle-commandment-cap-exceeded`, `principle-public-unsafe-marker`, `principle-incoherent-archetype-applies-to`).

- [ ] **Commit (signed):** `doc(wiki): principle awareness in visual-navigation spec`.

### Task A.18 — Public docs generator + Jekyll integration

**Files:** `scripts/generate-public-principles.mjs` + `.test.mjs`, `docs/principles.md`, `docs/index.html`, `docs/README.md`, `docs/_config.yml` (if needed), root `package.json`

- [ ] **Write failing test** for the generator with a small fixture directory: three principle markdown files (one per tier, all `principlePublic: true`), expected output is a single deterministic `principles.md` matching a stored snapshot.
- [ ] **Run test, verify it fails.**
- [ ] **Implement** the generator with a small local YAML-frontmatter parser (no new root dependency). Reads `docs/founder-kernel/wiki/principles/*.md`, filters to `principlePublic: true`, groups by tier (Commandments → Core → Contextual), emits Jekyll frontmatter + intro + tiered sections + per-principle title/direction/rule/why/applies-to/how-to-apply, plus public-safe source citations.
- [ ] **Run test, verify it passes.**
- [ ] **Run** `pnpm docs:principles` against the real kernel and commit the resulting `docs/principles.md`.
- [ ] **Add the snapshot-drift CI test** that runs the generator against the real kernel and asserts byte-for-byte match with the committed output. Anyone editing kernel principles without re-running the generator is caught before merge.
- [ ] **Add navigation links** from `docs/index.html` and `docs/README.md`.
- [ ] **Add `docs:principles` and `test:docs:principles` script entries** to root `package.json`.
- [ ] **Commit (signed):** `feat(docs): generate public principles markdown from kernel with snapshot drift detection`.

### Task A.19 — AGENTS.md discovery pointer

**Files:** `AGENTS.md`

**Gate:** only run after Task A.11 (external MCP visibility) merges or is otherwise verified, per spec §12.3.

- [ ] **Verify** Task A.11 is on `origin/main`: `git log origin/main --oneline -- apps/web/app/api/mcp/v1/`.
- [ ] **Add a short pointer paragraph** near the top of `AGENTS.md`: "For durable DPF governance principles, query `wiki_query` with `pageKind='principle'` when the MCP connector is available. AGENTS.md remains operationally authoritative when MCP is offline."
- [ ] **Verify** `AGENTS.md` still reads end-to-end as a standalone agent guide without network access. Operational mechanics (commands, branch rules, verification, worktree, MCP token, local QA) stay inline.
- [ ] **Commit (signed):** `doc(agents): add wiki principle discovery pointer`.

### Phase A Verification

```powershell
pnpm --filter @dpf/db exec vitest run src/wiki-store.test.ts src/seed-wiki-kernel.test.ts src/wiki-taxonomy.test.ts
pnpm --filter web exec vitest run lib/wiki/embeddings.test.ts lib/wiki/recall.test.ts lib/wiki/principle-recall.test.ts lib/wiki/principle-decide.test.ts lib/wiki/lint
pnpm --filter web exec vitest run lib/mcp-tools-wiki-query.test.ts lib/mcp-tools-principle-decide.test.ts
pnpm --filter web exec vitest run app/api/mcp/v1
pnpm --filter web exec vitest run components/wiki "app/(shell)/admin/wiki/lint"
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter @dpf/db exec prisma migrate status
pnpm docs:principles
pnpm test:docs:principles
pnpm --filter web exec vitest run                    # full web suite before push
```

**UX verification (rebuilt Docker portal):**

- `/wiki?kind=principle` — default tier-first grouping, CA filter chips work, sort toggle flips to CA-first, Build Studio rows isolated under Route / Domain Specific > Build Studio.
- A principle detail page — metadata panel shows tier, archetype, contexts, applies-to, weight, sources, dimension table.
- `/admin/wiki/lint` — principle filter chips work, coherence findings appear when seeded principles violate §8A.1.
- A coworker chat — system prompt shows `## Governance Principles` block from `recallWikiContext`.
- In-portal MCP debugger — `principle_decide` returns a contribution ledger on two synthetic options.
- Jekyll preview — `/principles/` renders, internal-only principles absent, navigation links work.
- Light + dark mode for all UI changes.

**Exit criteria:**

- All Phase A tests pass; full web build is clean.
- Migration applies cleanly on a fresh DB.
- All 41 existing principle pages pass lint with zero blocking findings after back-fill.
- `wiki_query` accepts the new filters; `principle_decide` returns ledgers with tier/conflict/coverage flags.
- External MCP `tools/list` exposes both for `registry_read` tokens.
- Public `docs/principles.md` matches the snapshot test against the kernel.
- `AGENTS.md` remains usable when MCP is offline.

**PR title:** `feat(principles): consumer archetypes, advisory decision support, retrieval, lint, UI, public docs`.

**PR body** must include:

- Backlog item / epic ID from Phase -1.
- Overlap-sweep snapshot (recent main + open PRs).
- Refactor-budget items retired.
- UX verification screenshots for `/wiki?kind=principle`, principle detail, lint admin, and `/principles/` Jekyll preview.
- Note that Phase B (kernel-slug uniqueness) is independent and tracked separately.

---

## Phase B — Kernel slug uniqueness (independent refactor PR)

**Branch:** `fix/wikipage-kernel-slug-uniqueness`

**Objective:** Close the wiki-platform correctness gap where `@@unique([organizationId, slug])` does not constrain rows where `organizationId IS NULL`. Not coupled to Phase A — ships independently and can land before, alongside, or after.

**Files to create:** `packages/db/prisma/migrations/<timestamp>_guard_kernel_wikipage_slug_uniqueness/migration.sql`

**Files to modify:** `packages/db/src/wiki-store.test.ts` (regression test).

### Task B.1 — Migration

- [ ] **Write failing regression test** in `wiki-store.test.ts`: inserting two kernel rows (`organizationId IS NULL`) with the same `slug` must fail with a unique-constraint error. Inserting an org overlay (`organizationId = "<id>"`) with the same `slug` as a kernel row remains legal.
- [ ] **Run test, verify it fails** (current schema allows the duplicate).
- [ ] **Create the migration:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "WikiPage_kernel_slug_key"
  ON "WikiPage"("slug")
  WHERE "organizationId" IS NULL;
```

- [ ] **Apply migration:** `pnpm --filter @dpf/db exec prisma migrate dev`.
- [ ] **Run test, verify it passes.**
- [ ] **Run full DB workspace tests:** all green.
- [ ] **Commit (signed):** `fix(db): guard kernel WikiPage.slug uniqueness when organizationId is NULL`.

### Phase B Verification

```powershell
pnpm --filter @dpf/db exec vitest run src/wiki-store.test.ts
pnpm --filter @dpf/db exec prisma migrate status
pnpm --filter web typecheck
pnpm --filter web build
```

**Exit criteria:**

- Two kernel rows cannot share a `slug`.
- Org overlay rows with the same `slug` as a kernel row remain legal.
- No existing kernel row pre-violates the new uniqueness — if any do, surface them in the PR and resolve before merge.

**PR title:** `fix(db): guard kernel WikiPage.slug uniqueness when organizationId is NULL`.

---

## Post-Implementation Audit

After Phase A merges:

- [ ] Confirm no durable principle-shaped rule still lives only in `AGENTS.md`, only in local memory, or only in a spec body. Single-source-of-truth check.
- [ ] Confirm the commandment cap of 10 published kernel commandments is intact.
- [ ] Confirm `principle_decide` returns non-empty contribution ledgers for at least three real DPF decisions (test cases: "quick patch vs refactor"; "connector under contribute mode"; "ship docs gen now vs follow-up"). Capture the ledgers in `docs/superpowers/audits/2026-MM-DD-principle-decide-audit.md`.
- [ ] Run the wiki lint orchestrator over the full kernel + portal corpus and confirm zero blocking principle findings.
- [ ] Confirm the snapshot-drift test caught at least one synthetic kernel edit (manually mutate a kernel principle, expect the test to fail, then revert).
- [ ] Decide whether `schemaVersion` graduates from `0.3.0` to `1.0.0` based on Phase A stability.

---

## Risks and How to Handle Them Mid-Implementation

| Risk | When it surfaces | Response |
|------|------------------|----------|
| Back-fill produces a coherence violation on an existing page | Task A.4 / A.12 | Fix the back-fill (adjust archetype or applies-to). Do not loosen lint. |
| Phase A retrieval is slow against Qdrant | UX verification | Profile `searchWikiPages` — add a GIN index on the new payload keys only if metrics demand it. Don't pre-optimize. |
| Lint surfaces a contradiction between two existing principles | Task A.12 | Expected and healthy. `principle-contradiction-review` is `warn`. Add a reviewer note explaining the intentional tension. |
| Public-safety lint blocks an existing principle page after back-fill | Task A.12 | Slow down. Rewrite the principle text in product-facing language. Don't loosen the lint. |
| Jekyll build breaks because generated markdown has YAML edge cases | Task A.18 | Add YAML-safe escaping to the generator (quote any value containing colons or hashes). Re-run snapshot test. |
| Commandment cap hits 10 during back-fill | Task A.4 | Reassign a candidate to core via review. Don't raise the cap silently — the cap is the principle. |
| External MCP visibility test reveals a route gating bug | Task A.11 | Patch the route, not the test. Block the AGENTS.md pointer until verified. |
| A concurrent session is editing principle pages in another worktree | Any push | The continuous overlap sweep should catch it. If you push first, leave a PR-body note; if they push first, rebase and re-run lint over the merged set. |

---

## Out of Scope (deferred)

- Dimension registry curation tooling — defer until decision ledgers show which dimensions are actually used.
- Org-overlay principle authoring UX (`/wiki?kind=principle&org=<id>`) — spec §11.6 documents the runtime contract; UX is a follow-up spec.
- `principle_decide` evidence recording for downstream workflows — spec §18 question 6 recommends not in V1.
- Commandment recall caching layer — optimize only if Phase A verification shows it's needed.
- Build Studio principle preview during planning — Build Studio integration is its own future spec.
- AHP / TOPSIS / weighted-product variants of the decision math — spec Appendix B explicitly notes V1 ships weighted-sum only.
- Migrating `principle_decide` to a tighter advisory grant — owned by the TAK epic (spec §11.5).

---

## Plan Review Checklist (run plan-document-reviewer before committing)

- [ ] Phase A and Phase B both have explicit branch names, file lists, TDD-shaped tasks, verification commands, and exit criteria.
- [ ] Phase A does not depend on Phase B and vice versa.
- [ ] Every code change is preceded by a failing test.
- [ ] Every test command is a workspace-pinned `pnpm --filter` invocation.
- [ ] Continuous overlap sweep is required before every push, not only at session start.
- [ ] The commandment cap of 10 is honored.
- [ ] Public-safety lint passes on every back-filled page.
- [ ] `AGENTS.md` remains operationally authoritative after Task A.19.
- [ ] Public docs render statically from kernel markdown (Task A.18), not from runtime DB.
- [ ] The plan references the spec's re-baselined §1.1 and does not assume any pre-baseline phase exists.
- [ ] Backlog item / epic ID is recorded in the PR body for Phase A per spec §1.2.
