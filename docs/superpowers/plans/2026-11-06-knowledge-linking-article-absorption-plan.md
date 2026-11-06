---
status: active
---

# Finish absorbing KnowledgeArticle into WikiPage — implementation plan (BI-67F04B3F)

Design: [article absorption scope manifest](../specs/2026-10-14-knowledge-linking-article-absorption-design.md),
under §6 of the [knowledge linking design](../specs/2026-10-14-knowledge-linking-design.md),
which keeps §2's scope rules: articles are the organization's own (WWWD)
knowledge and become overlay pages, never kernel or profession pages (R4).
Each phase is test-first: the failing behaviour test lands before the code.

Grounded on `main` 765a432c. Substrate facts this plan builds on:

- `KnowledgeArticle`, `KnowledgeArticleRevision`, `KnowledgeArticleProduct`,
  `KnowledgeArticlePortfolio` (`packages/db/prisma/schema/knowledge-docs.prisma:250-315`).
  `category`, `status` and `visibility` are free strings. `KnowledgeArticleRevision.createdByAgentId`
  has no foreign key, but `WikiPageRevision.createdByAgentId` does.
- `DigitalProduct`, `Portfolio` and `User` carry no `organizationId`, and the
  schema has no user-to-organization membership yet (BI-1B4AB42A, cited in
  `apps/web/lib/wiki/reader-organization.ts`). Only rule 3 of the
  organization order can resolve anything today (see Phase 1).
- Overlay writes: `createWikiOverlayPage`, `upsertWikiPage` and `appendRevision`
  (`packages/db/src/wiki-store.ts`). `WikiRevisionChangeKind` is
  `ingest | manual | lint-fix | kernel-merge`.
- Vectors: `vector_embedding` through `packages/db/src/pgvector-store.ts`.
  `storeKnowledgeArticle` / `searchKnowledgeArticles` (`apps/web/lib/inference/semantic-memory.ts:609-697`)
  write and read `knowledge-article-<id>` points in `platform-knowledge`.
  Published wiki pages are embedded and re-embedded at boot by
  `reconcilePublishedWikiEmbeddings` (`apps/web/lib/wiki/embedding-reconciliation.ts`).
- Model retirement precedent: #6058 (`248ff3f3c23`). Its migration drops a table only
  when it is empty and otherwise archives it as `<name>_retired_<item>`. It also
  adds schema-regression-guard entries (`INTENTIONAL_MODEL_REMOVALS`,
  `INTENTIONAL_FIELD_REMOVALS`), shrinks the baselines and writes a data-impact
  manifest. The model renames use `INTENTIONAL_MODEL_RENAMES`, which requires
  `@@map("<old name>")` (`packages/db/scripts/schema-regression-guard.mjs:354-371`).

## What ships when

| Phase | Ships in | Content |
|-------|----------|---------|
| 1–6 | This change (BI-67F04B3F) | Mapping and organization rule, one additive migration, boot absorption and embeddings, compatibility aliases, the retirement guard and steward record, Qdrant corrections |
| 7 | A later release, after one release of the compatibility window | Drop `KnowledgeArticle` and `KnowledgeArticleRevision` behind the guard; remove the aliases |

## Phase 1 — mapping and the organization rule (pure)

New `packages/db/src/knowledge-article-absorption.ts`, with no database access:

- `legacyArticleSlug(articleId, title)` = `"knowledge/" + kebab(articleId + "-" + title)`.
  It keeps only ASCII alphanumerics, collapses runs of other characters to one `-`,
  trims dashes and caps the result at 120 characters. The `KA-` prefix keeps it
  unique.
- `pageKindForCategory(category)`: `how-to`, `runbook` and `troubleshooting` map to
  `runbook`, `decision` maps to `decision`, and `policy`, `process` and `reference`
  map to `summary`. An unknown category maps to `summary` and is recorded.
- `pageStatusFor(article)`: status maps one to one. A `team` article becomes `draft`
  whatever its status was.
- `pageMetadataFor(article)` returns `legacyArticleId`, `visibility`,
  `valueStreams`, `tags` and `reviewIntervalDays` (the spec's list). It adds
  `category` and `legacyStatus`, because the aliases need the original category
  (the page-kind mapping loses it) and a `team` draft must keep its original
  status for the steward. It also adds `absorbedFrom: "KnowledgeArticle"`. A
  `team` article gets `heldForSteward: true`.
- `resolveArticleOrganization({ anchorOrganizationIds, authorOrganizationId, installOrganizationIds })`
  applies the spec order: the anchors' organization (only if every anchor agrees),
  then the author's organization, then the install's single organization. It
  returns `{ organizationId }` or `{ held: "ambiguous" | "no-organization" | "anchor-conflict" }`.
  It never picks the first row. Today the caller passes empty anchor and author
  inputs, because the schema has no column to read them from. They become real
  inputs when BI-1B4AB42A adds membership, and the resolver does not change.

Tests (`packages/db/src/knowledge-article-absorption.test.ts`):

- every category, status and visibility combination;
- slug cases: punctuation, non-ASCII and over-long titles;
- the resolver: zero, one and two organizations, conflicting anchors, and the
  author's organization winning over a single install organization.

Covers AC-KLA-1 and AC-KLA-2.

## Phase 2 — one additive migration (pages, revisions, renamed anchors)

Migration `packages/db/prisma/migrations/20261106100000_absorb_knowledge_articles_into_wiki_pages/migration.sql`.
It runs in one transaction under `migrate deploy`. It never deletes an article or
revision row (`never-wipe-db-for-code-fixes`):

1. **Pages.** For each article whose organization resolves, insert a `WikiPage`
   (`isKernel = false`, `organizationId` set). The slug, kind, status and metadata
   follow Phase 1. `abstract`, `lastReviewedAt`, `createdAt` and `updatedAt` are
   copied. The SQL implements rule 3 only (`count("Organization") = 1`), since
   rules 1 and 2 have no column (see the substrate facts). If an
   `(organizationId, slug)` row already exists, the article is held with reason
   `slug-conflict` and nothing is overwritten.
2. **Revisions.** Every `KnowledgeArticleRevision` row becomes a `WikiPageRevision`
   with the same `version`, `title`, `body`, `changeSummary`, `createdAt` and
   `createdById`, and `changeKind = 'manual'` (each was an authored edit; the
   absorption itself is recorded in page metadata). A `createdByAgentId` that
   matches no `Agent.id` is written as null, and the id is appended to
   `changeSummary`, so the foreign key cannot abort the migration and the
   attribution is kept. If the article body differs from its newest revision, or
   the article has no revision, one more revision (`max + 1`, `changeSummary`
   "Absorbed from <KA-id>") preserves the live body.
3. **Anchors.** Rename the models `KnowledgeArticleProduct` → `WikiPageProduct`
   and `KnowledgeArticlePortfolio` → `WikiPagePortfolio`. They keep
   `@@map("KnowledgeArticleProduct")` and `@@map("KnowledgeArticlePortfolio")`,
   as `INTENTIONAL_MODEL_RENAMES` requires. The key moves from article to page:
   - add `pageId` with a foreign key to `WikiPage(id)` and `ON DELETE CASCADE`,
     and backfill it from the new pages;
   - make the primary keys `(pageId, digitalProductId)` and `(pageId, portfolioId)`,
     with `pageId` indexes;
   - drop `articleId` and its foreign key.
   The `digitalProductId` and `portfolioId` foreign keys and cascades are not
   touched. Anchor rows of held articles cannot be keyed on a page, so before the
   re-key they are copied into `KnowledgeArticleAnchor_held_bi67f04b3f`
   (`articleId`, `kind`, `targetId`, with a table comment). That table sits
   outside the Prisma schema, the same archive pattern #6058 uses. No anchor row
   is lost.
4. **Schema and guard.** Make these edits:
   - `WikiPage` gains `products WikiPageProduct[]` and `portfolios WikiPagePortfolio[]`.
   - `DigitalProduct.knowledgeArticles` and `Portfolio.knowledgeArticles` become
     `wikiPages`.
   - `KnowledgeArticle` loses `products` and `portfolios`.
   - `schema-regression-guard.mjs` gets the two `INTENTIONAL_MODEL_RENAMES` entries,
     plus `INTENTIONAL_FIELD_REMOVALS` entries for the dropped `articleId` and
     `article` fields and for the four relation-only fields above.
   - `prismaModelCount` is unchanged.
5. **Steward retention record.** Add `/// @dpf` lines to `KnowledgeArticle` and
   `KnowledgeArticleRevision`: `lifecycle=business-record retention=domain`,
   `steward=data-steward`. Add the same lines to the two renamed join models.
   Move their four `legacy-coverage-baseline.ts` entries (BI-DG-015) to the
   renamed models. Update the shrink-only baselines:
   `scripts/fk-index-coverage-baseline.json`, `scripts/model-metadata-baseline.txt`,
   `scripts/stewardship-scope-baseline.txt` and `scripts/label-association-baseline.json`.

**Data-impact note**, `docs/data-impact/2026-11-06-absorb-knowledge-articles.data-impact.json`
(owner `data-architecture`):

- the migration name, and the row counts at authoring time (dev install:
  3 articles, KA-001 published, KA-002 and KA-003 archived, one organization, so
  nothing is held);
- per model, the disposition: two models renamed and re-keyed, `KnowledgeArticle`
  and its revisions kept read-only until Phase 7;
- the held-anchor archive table;
- the steward's retention decision: the article tables are `business-record` and
  are kept until every row maps. They are then dropped if empty and archived as
  `<name>_retired_bi67f04b3f` if not, the #6058 rule. Retirement never purges
  rows.

Its `affectedCopies` lists the EA data-model mirror and the baselines above.

Tests:

- `packages/db/src/absorb-knowledge-articles-migration.test.ts`, against
  `DATABASE_URL` with fixture tables, in the style of #6058's test. Cases:
  single organization (pages, revisions with version numbers, re-keyed anchors
  with intact foreign keys); zero and two organizations (articles held, anchors
  archived, no `WikiPage` written); a `team` article (draft, `legacyStatus` kept);
  a dangling agent id; a body that differs from the latest revision; a slug
  conflict; and a second application, which does nothing.
- A parity test that runs the SQL slug, kind and status expressions and
  `knowledge-article-absorption.ts` over the same fixtures, so the two cannot
  drift.
- `packages/db/scripts/schema-regression-guard.test.ts` accepts the rename and
  re-key, and still fails on an unlisted field drop.
- `scripts/check-data-impact.test.mjs`.

Covers AC-KLA-1 and AC-KLA-2.

## Phase 3 — boot absorption, held list and embeddings

New `apps/web/lib/wiki/knowledge-article-absorption.server.ts`, called from
`apps/web/instrumentation.ts` next to `backfillOrgWwwdOnBoot`. It is idempotent,
does nothing once complete, and never stops the boot:

- **Held articles.** The listing is computed, not stored: articles without a page,
  each with its reason. When the resolver can decide one (for example, an install
  with no organization at upgrade that has since onboarded one), boot absorbs it.
  It writes through `upsertWikiPage` and `appendRevision` and restores anchors from
  the held archive, using the same Phase 1 functions.
  `resolveHeldKnowledgeArticle(articleId, organizationId)` is the administrator's
  explicit decision. It is a server action that needs the existing
  `manage_backlog` capability; nothing chooses an organization for the
  administrator.
- **Embeddings.** Absorbed published pages are embedded into `wiki-pages` with
  `storeWikiPage`; `reconcilePublishedWikiEmbeddings` would also find them. Draft
  and archived pages are embedded when they are published, by the existing
  `embed-published-overlay.ts`. That matches what was searchable before:
  `searchKnowledgeArticles` returned published articles only.
- **Old points.** `deleteVectors(PLATFORM_KNOWLEDGE, entityType = knowledge-article, entityId ∈ absorbed)`
  removes the points of absorbed articles only. `search_knowledge` keeps
  searching the rest of `platform-knowledge`.
- **Old ids.** `findPageByLegacyArticleId(db, organizationId, "KA-001")` resolves
  through `metadata.legacyArticleId`. The `KA-` branch of the BI-A63A9476
  reference parser calls it once that parser lands. The parser is not on `main`,
  so this change ships and tests only the lookup.

Tests (`knowledge-article-absorption.server.test.ts`):

- held listing and later absorption, including anchors restored from the archive;
- the administrator's resolution, refused without the capability;
- published pages embedded and draft pages not;
- only absorbed articles' points deleted;
- a second boot is a no-op;
- legacy id lookup, including another organization's page staying invisible.

Covers AC-KLA-6 and AC-KLA-2.

## Phase 4 — compatibility window: aliases over WikiPage (one release)

`apps/web/lib/mcp/packs/knowledge-pack.ts`:

- **`search_knowledge_base`** becomes a WWWD-only `searchWikiPages` pass
  (`apps/web/lib/wiki/embeddings.ts`, `source: "org"`) for the reader's
  organization. That organization comes from `resolveReaderOrganizationId`; when
  it is null the tool returns no organization pages and says why. The
  `productId` and `portfolioId` filters use `WikiPageProduct` and
  `WikiPagePortfolio`, `category` uses `metadata.category`, and `valueStream` uses
  `metadata.valueStreams`. The response keeps its shape
  `{ articleId, title, category, contentPreview, score }`: `articleId` is
  `legacyArticleId`, or the slug for pages created after absorption, and
  `category` falls back to `pageKind`. The grant stays `registry_read`. If
  BI-825D3487 lands first, the alias inherits `wiki_org_read` like the other
  knowledge reads.
- **`create_knowledge_article`** creates a **draft** overlay page through
  `createWikiOverlayPage`: slug `knowledge/<kebab(title)>-<short id>`, revision 1
  `manual`, anchors in the renamed tables, and the metadata from Phase 1. The
  spec says "opens an overlay page proposal". This plan reads that as the draft
  page, which `list_wiki_overlay_drafts` / `publish_wiki_overlay_pages` then
  review and publish. The tool stays `executionMode: "immediate"`, because
  BI-0073DE6A removed the stacked approval a proposal mode would bring back.
  The tool refuses cleanly when no single organization resolves.
- **`flag_stale_knowledge`** reads published overlay pages where
  `(lastReviewedAt ?? createdAt) + metadata.reviewIntervalDays` (default 90) is
  past, with the same product and portfolio filters.
- **Deprecation notice.** Each of the three adds a `deprecation` object to `data`
  that names its replacement (`wiki_query`, the overlay editor,
  `list_wiki_overlay_drafts`), and writes one structured warning per call.
- **Routes.**
  - `/knowledge` and `/knowledge/[articleId]` redirect to the wiki: to the mapped
    page, or to the index filtered to the organization. The index is
    `/coworker-decisions` (`/wiki` already redirects there). It gains a
    `?corpus=org` filter that reads its organization through
    `resolveReaderOrganizationId`, not `findFirst`.
  - `/knowledge` lists held articles to a user with `manage_backlog` before
    redirecting, with the resolve action.
  - `/knowledge/new` redirects to the overlay editor.
  - `portfolio/product/[id]/knowledge` and its `_count` on
    `portfolio/product/[id]/page.tsx` read `WikiPageProduct`.
  - `components/knowledge/*` are kept only where the product tab still renders them.
- **Libraries repointed to WikiPage:**
  - `lib/actions/knowledge.ts`: the remaining actions delegate to the overlay
    actions;
  - `lib/actions/route-knowledge-pointers.ts`;
  - `coworker-self-tasks.ts:446` (`hasRecentKnowledgeArticle` checks the title
    prefix on `knowledge/` overlay pages);
  - `product-operating-context-query*.ts`;
  - `semantic-memory.ts`: `storeKnowledgeArticle` and `searchKnowledgeArticles`
    are deleted once no caller is left.
- **Unchanged.** These keep their entries, because the tool names still exist
  during the window:
  - the route contexts (`lib/tak/{agriculture,product-line,product}-route-context.ts`,
    `route-context-map.ts`) and `product-management-playbook.ts`;
  - `agent-grants.ts`, `grant_catalog.json` and `platform-tools-snapshot.json`;
  - `known-unclassified-side-effect-tools.ts` and `tool-result-provenance.ts`.

Tests:

- `knowledge-pack.test.ts`:
  - all three tools over WikiPage fixtures, with the same response shape;
  - every filter;
  - the deprecation field;
  - a page from another organization absent (R1);
  - refusal with no organization.
- `coworker-self-tasks.test.ts` and `knowledge-self-task-authority.test.ts`;
- `product-operating-context-query.test.ts`;
- `portfolio/product/[id]/page.test.tsx`;
- redirect tests for the three `/knowledge` routes;
- a test for the `?corpus=org` filter.

The `dpf-ux-fit-review` skill applies to the held-articles list and the filter
(theme tokens only).

Covers AC-KLA-3 and AC-KLA-4 (consumers repointed).

## Phase 5 — the retirement guard and steward record (ships now)

- `countUnabsorbedArticles(db)` in `knowledge-article-absorption.ts` is the single
  predicate: articles with no page carrying their `legacyArticleId`.
- **Schema-regression guard rule.** The guard refuses a diff that removes
  `KnowledgeArticle` or `KnowledgeArticleRevision` (an `INTENTIONAL_MODEL_REMOVALS`
  entry) unless the same diff adds a migration with the `-- dpf:guard knowledge-article-absorbed`
  block. That block archives a table instead of dropping it while
  `countUnabsorbedArticles` would be non-zero. Without it, the guard fails.
- The steward retention decision is recorded in Phase 2's data-impact note and
  `@dpf` lines.

Tests:

- `schema-regression-guard.test.ts`: removal without the block fails, removal with
  it passes;
- predicate tests over mapped, held and `team` rows.

Covers AC-KLA-4.

## Phase 6 — Qdrant corrections

Present-tense statements are rewritten to name pgvector in Postgres
(`vector_embedding`, `packages/db/src/pgvector-store.ts`). Statements written as
history stay.

- `docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md` (EP-WIKI-001):
  - §0.1 table (line 34), §0.2 (heading and body), §1 (line 64) and §3.2 (line 124);
  - §5 (line 326), §9 (line 384), §11 step 4 (line 428) and §14 (line 483);
  - the 2026-10-14 supersession note becomes a short "corrected by BI-67F04B3F" line.
- Other active specs that still describe Qdrant as current:
  - `2026-07-10-demand-management-design.md:193`;
  - `2026-09-08-data-lifecycle-stewardship-convergence-design.md:122`;
  - `2026-10-14-document-permissions-and-files-design.md:59`.
- Schema comments, which this change already owns:
  - `knowledge-docs.prisma:6`;
  - `core-identity.prisma:491` (`vector` retrieval mode);
  - `ops-telemetry.prisma:109`.
- Seeds:
  - `packages/db/src/seed-ea-sysml-data-authority.ts`: `part:qdrant` is renamed and
    re-described as the pgvector projection. Its persisted key stays, because
    renaming a seeded key would orphan the installed EA element. That is the seed
    decision its allowlist entry deferred.
  - `packages/db/data/agent_control_plane_maturity_seed.json:162`: `Qdrant` becomes
    `pgvector`.
- `scripts/retired-substrate.json`: remove each allowlist entry whose file no longer
  names Qdrant or Neo4j. The allowlist is shrink-only, so a stale entry fails. A file
  that still names Neo4j keeps its entry, with its reason narrowed to Neo4j.
  Neo4j wording is outside this item.

Tests: `pnpm check:retired-substrate` and `scripts/check-retired-substrate.test.mjs`,
the seed test (`seed-ea-sysml-data-authority.test.ts`), and docs lint.

Covers AC-KLA-5.

## Phase 7 — retirement (later release; separate follow-up item)

This phase ships no earlier than one release after Phase 4 reaches installs.
Steps:

- Migration `…_retire_knowledge_article` carries the `dpf:guard knowledge-article-absorbed`
  block. Per table it does nothing when the table is absent, drops it when every
  row maps, and otherwise archives it as `<name>_retired_bi67f04b3f`. The held
  anchor archive is dropped when empty.
- Schema: remove both models, add `INTENTIONAL_MODEL_REMOVALS` entries and the
  back-relation removals (`User.knowledgeArticles`, `User.knowledgeRevisions`,
  `Agent.knowledgeArticles`), and prune the Phase 2 rename entries. Optionally
  rename the physical join tables to `WikiPageProduct` and `WikiPagePortfolio`.
- Remove the three alias tools, or repoint every route context and the playbook
  to `wiki_query`. Remove their grant, catalog and snapshot entries, and the GPP
  and provenance lists.
- Remove the `/knowledge` routes and `components/knowledge/*`, and drop
  `KnowledgeArticle` from the `MENTIONS` range in
  `packages/db/src/relation-vocabulary-entries.ts`.
- Shrink the baselines. `prismaModelCount` drops by 2.
- Write the data-impact note for the retirement migration, with live row counts
  and the held count.

## Traceability

requirement: OBJ-KLA-1, OBJ-KLA-2, OBJ-KLA-3.
contract: knowledge-article-absorption mapping and organization-resolution contract; WikiPageProduct / WikiPagePortfolio anchor contract; knowledge-pack alias response contract.
flow: KnowledgeArticle row → organization resolved or held → overlay WikiPage + revisions + re-keyed anchors → wiki-pages embedding → aliases and /knowledge read WikiPage → guarded retirement.
verification: AC-KLA-1, AC-KLA-2, AC-KLA-3, AC-KLA-4, AC-KLA-5, AC-KLA-6.

| Requirement | Planned behavior | Acceptance verification |
| --- | --- | --- |
| OBJ-KLA-1 | Phases 1–3: mapping and organization rule, the additive migration with revisions and re-keyed anchors, held articles listed and absorbed later, embeddings and legacy-id lookup. | AC-KLA-1, AC-KLA-2 and AC-KLA-6. |
| OBJ-KLA-2 | Phases 4–5: the three tools and `/knowledge` as aliases over WikiPage with deprecation notices, every §6 consumer repointed, the retirement guard and steward record; Phase 7 retires in a later release. | AC-KLA-3 and AC-KLA-4. |
| OBJ-KLA-3 | Phase 6: EP-WIKI-001, active specs, schema comments and seeds name pgvector; the retired-substrate allowlist shrinks. | AC-KLA-5. |

## Backlog coverage

Phases 1–6 are atomic under BI-67F04B3F. The migration without the aliases
would break `/knowledge`, the product tab and the three tools on upgrade. The
aliases without the migration have no pages to read, and the guard protects
nothing until pages exist. The Qdrant corrections share the schema-comment edits
and the retired-substrate allowlist with Phase 2. Every deliverable in Phases 1–6
maps to BI-67F04B3F.

Phase 7 can ship on its own. It ships in a different release, after the window,
and depends only on the guard and the data that this change leaves. It maps to
a separate follow-up item, BI-737791E5 (retire KnowledgeArticle after the
compatibility window).

## Risk and rollback

- **A held article loses visibility.** On an install with zero or several
  organizations, articles are held rather than guessed, so the organization
  cannot read them until an administrator resolves them. `/knowledge` lists them
  with their reason, and their anchors are archived, not lost.
- **Team articles.** A `team` article becomes a draft, never an organization-wide
  page, until the steward decides. A draft is not embedded or searched.
- **The migration test does not run in CI.** It needs `DATABASE_URL`, and no CI
  job has Postgres. Run it locally against Postgres and report it as run or
  unrun. The parity test and the guard tests run everywhere.
- **Rollback before Phase 7.** No article or revision row is deleted, and the
  renamed join tables keep their physical names. A revert therefore needs only:
  - a forward migration that restores `articleId` from
    `WikiPage.metadata.legacyArticleId` and the held archive;
  - deleting the absorbed pages, which can be identified by
    `metadata.absorbedFrom`.

  Embeddings rebuild from Postgres. Write that forward migration only if it is
  needed; do not pre-build it.
- **Search drift.** WWWD search over every overlay page can return more than the
  article-only search did, but only the reader's own organization pages (R1, R4).
