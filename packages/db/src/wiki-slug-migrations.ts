// Slug renames for wiki pages that move between corpora (BI-5FE47130).
//
// THE PROBLEM THIS SOLVES
// A principle's slug is derived from its path: kernel pages become
// `principles/<name>`, profession-corpus pages become
// `professions/<profession>/<name>`. So migrating a principle out of the
// kernel and into a profession corpus CHANGES ITS SLUG — and `upsertWikiPage`
// keys on `(organizationId, slug)`. Move the file and the seed finds no row for
// the new slug, creates a fresh one, and leaves the old row behind.
//
// That is not a cosmetic problem. `WikiPage` has no `previousSlug` / `aliasOf`
// column, so nothing records that the new page continues the old one, and
// `WikiPageVersion` (plus the other `pageId` relations) is `onDelete: Cascade`.
// A naive move therefore forces a choice between:
//   - leaving the old row orphaned — a duplicate principle, and a stale Qdrant
//     point of exactly the class BI-6ADB019D found live; or
//   - deleting it, which destroys its version history.
//
// Neither satisfies the spec's "preserving decision history" requirement.
//
// THE FIX: rename in place, before the upsert pass. The row keeps its id, so
// its version history, decision references, and existing Qdrant point all stay
// valid — only the lookup key moves. No schema change and no new column.
//
// Two alternatives were rejected:
//   - An explicit `slug:` in the moved file's frontmatter, preserving the
//     kernel slug. The seeder honours `frontmatter.slug ?? deriveSlug(...)`, so
//     this WOULD work mechanically — but the `professions/` slug prefix is
//     load-bearing for WSID scoping, so the page would move on disk and stay
//     invisible to profession retrieval.
//   - Adding a `previousSlug` column. Solves it, but needs a migration to carry
//     information the rename makes unnecessary.
//
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md §3 step 3.

/** One recorded corpus move. */
export type WikiSlugMigration = {
  from: string;
  to: string;
  /** Why this page moved — kept with the rename so the audit trail is local. */
  reason: string;
};

/**
 * Applied in order, every seed run. **Append-only**: an entry stays here
 * permanently, because a fresh install seeds the page directly at its new slug
 * and the rename is a no-op, while an existing install needs it forever.
 * Removing an entry would strand any install that had not yet run it.
 */
export const WIKI_SLUG_MIGRATIONS: readonly WikiSlugMigration[] = [
  // First cohort: single-context `data-model` principles that are sourced
  // professional practice, moved to the data-architect corpus. Excludes
  // `db-fallback-explicit` (also tagged `mcp`, so its home is ambiguous) and
  // the six uncited ones, which need the provenance/bucket triage first.
  {
    from: "principles/fix-the-seed-not-the-runtime",
    to: "professions/data-architect/fix-the-seed-not-the-runtime",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/live-state-over-seed-data",
    to: "professions/data-architect/live-state-over-seed-data",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/native-cohesion-over-interfacing",
    to: "professions/data-architect/native-cohesion-over-interfacing",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/one-data-model",
    to: "professions/data-architect/one-data-model",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/organization-canonical-identity",
    to: "professions/data-architect/organization-canonical-identity",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/principal-convergence",
    to: "professions/data-architect/principal-convergence",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/schema-audit-before-features",
    to: "professions/data-architect/schema-audit-before-features",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/strongly-typed-string-enums",
    to: "professions/data-architect/strongly-typed-string-enums",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  {
    from: "principles/trust-the-data-spine",
    to: "professions/data-architect/trust-the-data-spine",
    reason: "data-model cohort -> data-architect (BI-5FE47130)",
  },
  // Second cohort: single-context sourced `mcp` principles that are software
  // engineering practice (evaluating + documenting tools).
  {
    from: "principles/tool-evaluation-pipeline",
    to: "professions/software-engineer/tool-evaluation-pipeline",
    reason: "mcp cohort -> software-engineer (BI-5FE47130)",
  },
  {
    from: "principles/tools-must-be-self-documenting",
    to: "professions/software-engineer/tools-must-be-self-documenting",
    reason: "mcp cohort -> software-engineer (BI-5FE47130)",
  },
];

export type SlugMigrationOutcome = {
  from: string;
  to: string;
  /**
   * `renamed` — rows moved to the new slug.
   * `already-migrated` — nothing at the old slug; the normal case after the
   *   first run, and on a fresh install.
   * `conflict` — rows exist at BOTH slugs. Not renamed: merging them would have
   *   to pick a survivor and silently discard the other's history, which is the
   *   very loss this module exists to prevent.
   */
  status: "renamed" | "already-migrated" | "conflict";
  rowsAffected: number;
};

type SlugMigrationClient = {
  wikiPage: {
    findMany: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Rename recorded slugs in place. Idempotent: after the first run the old slug
 * no longer exists, so every subsequent run reports `already-migrated`.
 *
 * Renames across ALL organizations, not just the kernel row — an org overlay of
 * a migrated principle has the same slug with a non-null `organizationId`, and
 * leaving overlays behind would strand them exactly as the orphaned-row case
 * would.
 */
export async function applyWikiSlugMigrations(
  db: SlugMigrationClient,
  migrations: readonly WikiSlugMigration[] = WIKI_SLUG_MIGRATIONS,
): Promise<SlugMigrationOutcome[]> {
  const outcomes: SlugMigrationOutcome[] = [];

  for (const migration of migrations) {
    const [atOld, atNew] = (await Promise.all([
      db.wikiPage.findMany({
        where: { slug: migration.from },
        select: { id: true, organizationId: true },
      }),
      db.wikiPage.findMany({
        where: { slug: migration.to },
        select: { id: true, organizationId: true },
      }),
    ])) as Array<Array<{ id: string; organizationId: string | null }>>;

    if (atOld.length === 0) {
      outcomes.push({
        from: migration.from,
        to: migration.to,
        status: "already-migrated",
        rowsAffected: 0,
      });
      continue;
    }

    if (atNew.length > 0) {
      // Both slugs populated. Renaming would violate the
      // @@unique([organizationId, slug]) constraint for any overlapping org,
      // and choosing a survivor would discard one page's history. Loud and
      // non-destructive: an operator resolves it deliberately.
      console.warn(
        `[wiki-slug-migrations] CONFLICT: "${migration.from}" and "${migration.to}" both exist ` +
          `(${atOld.length} old, ${atNew.length} new). Not renaming — merging would discard one page's ` +
          `version history. Resolve manually, then re-run the seed.`,
      );
      outcomes.push({
        from: migration.from,
        to: migration.to,
        status: "conflict",
        rowsAffected: 0,
      });
      continue;
    }

    const updated = (await db.wikiPage.updateMany({
      where: { slug: migration.from },
      data: { slug: migration.to },
    })) as { count: number };

    console.info(
      `[wiki-slug-migrations] renamed "${migration.from}" -> "${migration.to}" ` +
        `(${updated.count} row(s)) — ${migration.reason}`,
    );
    outcomes.push({
      from: migration.from,
      to: migration.to,
      status: "renamed",
      rowsAffected: updated.count,
    });
  }

  return outcomes;
}
