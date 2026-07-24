import { describe, expect, it, vi } from "vitest";
import {
  WIKI_SLUG_MIGRATIONS,
  applyWikiSlugMigrations,
  type WikiSlugMigration,
} from "./wiki-slug-migrations";

// BI-5FE47130. The rename pass is what makes a corpus migration non-destructive:
// it moves the lookup key while the row (and therefore its version history,
// decision references, and Qdrant point) stays put. These tests pin the
// properties that make that true — especially the refusal to merge, which is
// the difference between "preserved history" and "silently discarded history".

function fakeDb(rowsBySlug: Record<string, Array<{ id: string; organizationId: string | null }>>) {
  const updateMany = vi.fn(async ({ where, data }: never) => {
    const w = where as unknown as { slug: string };
    const d = data as unknown as { slug: string };
    const moved = rowsBySlug[w.slug] ?? [];
    rowsBySlug[d.slug] = [...(rowsBySlug[d.slug] ?? []), ...moved];
    delete rowsBySlug[w.slug];
    return { count: moved.length };
  });
  const findMany = vi.fn(async ({ where }: never) => {
    const w = where as unknown as { slug: string };
    return rowsBySlug[w.slug] ?? [];
  });
  return { db: { wikiPage: { findMany, updateMany } }, updateMany, rowsBySlug };
}

const MIGRATION: WikiSlugMigration = {
  from: "principles/one-data-model",
  to: "professions/data-architect/one-data-model",
  reason: "test",
};

describe("applyWikiSlugMigrations", () => {
  it("renames in place so the row id — and its history — survives", async () => {
    const { db, rowsBySlug } = fakeDb({
      "principles/one-data-model": [{ id: "page-1", organizationId: null }],
    });

    const [outcome] = await applyWikiSlugMigrations(db as never, [MIGRATION]);

    expect(outcome.status).toBe("renamed");
    expect(outcome.rowsAffected).toBe(1);
    // The SAME row now answers to the new slug. Nothing was created or deleted,
    // which is the whole point: WikiPageVersion cascades on delete.
    expect(rowsBySlug["professions/data-architect/one-data-model"]).toEqual([
      { id: "page-1", organizationId: null },
    ]);
    expect(rowsBySlug["principles/one-data-model"]).toBeUndefined();
  });

  it("is idempotent — a second run is a no-op, not a second rename", async () => {
    const { db, updateMany } = fakeDb({
      "principles/one-data-model": [{ id: "page-1", organizationId: null }],
    });

    await applyWikiSlugMigrations(db as never, [MIGRATION]);
    const [second] = await applyWikiSlugMigrations(db as never, [MIGRATION]);

    expect(second.status).toBe("already-migrated");
    expect(second.rowsAffected).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("reports already-migrated on a fresh install, where the old slug never existed", async () => {
    const { db, updateMany } = fakeDb({});
    const [outcome] = await applyWikiSlugMigrations(db as never, [MIGRATION]);
    expect(outcome.status).toBe("already-migrated");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("carries org overlays across, not just the kernel row", async () => {
    // An overlay shares the slug with a non-null organizationId. Renaming only
    // the kernel row would strand the overlay at the old slug — the same
    // orphaning this module exists to prevent.
    const { db, rowsBySlug } = fakeDb({
      "principles/one-data-model": [
        { id: "kernel-1", organizationId: null },
        { id: "overlay-1", organizationId: "org-a" },
      ],
    });

    const [outcome] = await applyWikiSlugMigrations(db as never, [MIGRATION]);

    expect(outcome.rowsAffected).toBe(2);
    expect(rowsBySlug["professions/data-architect/one-data-model"]).toHaveLength(2);
  });

  it("REFUSES to merge when both slugs exist, rather than picking a survivor", async () => {
    // The load-bearing safety property. Merging would have to discard one
    // page's version history, which is exactly the loss this module prevents —
    // and it would breach @@unique([organizationId, slug]) for any shared org.
    const { db, updateMany, rowsBySlug } = fakeDb({
      "principles/one-data-model": [{ id: "old-1", organizationId: null }],
      "professions/data-architect/one-data-model": [{ id: "new-1", organizationId: null }],
    });

    const [outcome] = await applyWikiSlugMigrations(db as never, [MIGRATION]);

    expect(outcome.status).toBe("conflict");
    expect(outcome.rowsAffected).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    // Both sides untouched — an operator resolves it deliberately.
    expect(rowsBySlug["principles/one-data-model"]).toHaveLength(1);
    expect(rowsBySlug["professions/data-architect/one-data-model"]).toHaveLength(1);
  });

  it("applies several migrations in order and reports each", async () => {
    const { db } = fakeDb({
      "principles/a": [{ id: "a1", organizationId: null }],
      "principles/b": [{ id: "b1", organizationId: null }],
    });

    const outcomes = await applyWikiSlugMigrations(db as never, [
      { from: "principles/a", to: "professions/x/a", reason: "t" },
      { from: "principles/b", to: "professions/x/b", reason: "t" },
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(["renamed", "renamed"]);
  });
});

describe("WIKI_SLUG_MIGRATIONS registry", () => {
  it("never maps two different sources onto the same destination", async () => {
    const seen = new Map<string, string>();
    for (const m of WIKI_SLUG_MIGRATIONS) {
      const prior = seen.get(m.to);
      expect(
        prior,
        `"${m.to}" is the destination of both "${prior}" and "${m.from}" — one would collide with the other`,
      ).toBeUndefined();
      seen.set(m.to, m.from);
    }
  });

  it("never renames a slug that a later entry renames again", async () => {
    // Chained renames (a -> b, b -> c) would depend on ordering and would make
    // the pass non-idempotent across installs at different points in the chain.
    const froms = new Set(WIKI_SLUG_MIGRATIONS.map((m) => m.from));
    for (const m of WIKI_SLUG_MIGRATIONS) {
      expect(
        froms.has(m.to),
        `"${m.to}" is both a destination and a source — collapse the chain into one entry`,
      ).toBe(false);
    }
  });

  it("records a reason on every entry, so the audit trail travels with the rename", () => {
    for (const m of WIKI_SLUG_MIGRATIONS) {
      expect(m.reason.trim().length, `${m.from} needs a reason`).toBeGreaterThan(0);
    }
  });
});
