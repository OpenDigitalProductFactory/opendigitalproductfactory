# Corpus Migration — Slug Rename Pass

- **Date:** 2026-07-24
- **Backlog:** `BI-5FE47130` (corpus migration), with `BI-6ADB019D` (phantom retrieval hits) as the sibling defect
- **Epic:** `EP-DECISION-TIER-REBALANCE`
- **Spec:** [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](../specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md) §3 step 3
- **Status:** machinery landed; first cohort not yet migrated

## Why this exists

The spec requires migration to preserve decision history. **It cannot, today.**

A principle's slug is derived from its path — kernel pages become `principles/<name>`, profession-corpus pages become `professions/<profession>/<name>`. So moving a principle out of the kernel **changes its slug**, and `upsertWikiPage` keys on `(organizationId, slug)`. Move the file and the seed finds no row for the new slug, creates a fresh one, and strands the original.

That is not cosmetic. `WikiPage` has no `previousSlug` / `aliasOf` column, so nothing records that the new page continues the old one, and `WikiPageVersion` (with the other `pageId` relations) is `onDelete: Cascade`. A naive `git mv` therefore forces a choice between:

- leaving the old row orphaned — a duplicate principle plus a stale Qdrant point, exactly the class found live in `BI-6ADB019D` (five hits for a principle the database holds one of); or
- deleting it, which **destroys its version history**.

## Approach: rename in place, before the upsert pass

`packages/db/src/wiki-slug-migrations.ts` holds an append-only `WIKI_SLUG_MIGRATIONS` list of `{ from, to, reason }`. `seedWikiKernel` applies it **before** seeding pages, so the existing row is simply found under its new key and updated in place. The row id survives, and with it the version history, decision references, and the existing Qdrant point. **No schema change and no new column.**

Properties, each pinned by test:
- **Idempotent** — after the first run the old slug is gone, so later runs are no-ops. A fresh install seeds directly at the new slug and reports `already-migrated`.
- **Overlay-safe** — renames across all organizations, not just the kernel row, so an org overlay is not stranded at the old slug.
- **Refuses to merge** — if both slugs exist it logs and does nothing. Merging would have to pick a survivor and discard the other's history, which is the loss this exists to prevent, and would breach `@@unique([organizationId, slug])` for any shared org.
- **Append-only** — an entry stays forever: a fresh install no-ops on it, but an install that has not yet run it still needs it.

### Alternatives rejected

| Option | Why not |
|---|---|
| Explicit `slug:` frontmatter preserving the kernel slug | Mechanically works — the seeder honours `frontmatter.slug ?? deriveSlug(...)` — but the `professions/` prefix is **load-bearing for WSID scoping**. The page would move on disk and stay invisible to profession retrieval. |
| Add a `previousSlug` column | Solves it, but needs a Prisma migration to carry information the rename makes unnecessary. |

## Migration cohort (measured 2026-07-24, do not re-derive)

**53** `route-domain-specific` principles, not the 39 the spec estimated, across ~7 professions: `engineering-flow` 27 · `data-model` 16 · `build-studio` 8 · `ui` 7 · `mcp` 6 · `release` 5 · `portfolio` 3. **11 are commandments** — the highest-risk moves, since a commandment leaving the kernel changes what binds every decision. Sequence those last and individually.

### The provenance constraint

WSID refuses to publish a profession page without a cited source. **30 of 53 have `sources`; 23 do not.** That is a signal, not merely an obstacle: an uncited principle is often *platform-native doctrine* rather than professional practice — `structural-verification-is-not-functional` is a commandment, and migrating it out would be wrong. Triage each into:

1. **Migrate** — sourced professional practice.
2. **Keep in WWMD, re-archetype off `route-domain-specific`** — platform doctrine, with the written universality justification the epic's acceptance #3 requires.
3. **Author provenance first** — genuinely professional but uncited.

## Next step — the proving cohort

`data-model` → `data-architect`: 16 principles, **zero commandments**, 10 already sourced. Per file: move it, change `principleConsumerArchetype` to `specialist`, add `professionCompetencyLevel`, and add a `WIKI_SLUG_MIGRATIONS` entry. Three of the six uncited (`bundled-services-active-by-default`, `no-provider-pinning`, `zero-click-provider-setup`) look mis-tagged as `data-model` — they are provider/platform doctrine and belong in bucket 2 or with `devops-platform`.

Verify after: the migrated pages keep their row ids, `principle_decide` still retrieves them under the profession scope, and no new phantom points appear in the recall trace (`phantomHitsDropped` stays 0).
