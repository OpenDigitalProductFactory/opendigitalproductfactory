import { describe, expect, it } from "vitest";

import {
  planPageMaterialRevocations,
  promotionForPageStatus,
  reconcilePageMaterialToStatus,
  syncPageMaterialAfterTransition,
  syncPageMaterialToStatus,
  type PageMaterialLifecycleClient,
} from "./page-material-lifecycle";

type Row = { materialId: string; promotionState: string; sourceRef: unknown };

// Interprets only the where/data shapes this module is allowed to use, so a
// test fails if the module starts writing outside the lifecycle rule.
function fakeDb(rows: Row[], pages: Array<{ id: string; status: string }>) {
  const writes: Array<{ where: unknown; data: unknown }> = [];
  const pageIdOf = (row: Row) => {
    const ref = row.sourceRef as Record<string, unknown> | null;
    return ref && typeof ref["wikiPageId"] === "string" ? (ref["wikiPageId"] as string) : null;
  };
  const db: PageMaterialLifecycleClient = {
    perspectiveMaterial: {
      async findMany(args: unknown) {
        const where = (args as { where: { promotionState: string } }).where;
        return rows
          .filter((row) => row.promotionState === where.promotionState)
          .map((row) => ({ materialId: row.materialId, sourceRef: row.sourceRef }));
      },
      async updateMany(args: unknown) {
        const { where, data } = args as {
          where: {
            promotionState: string;
            sourceRef?: { path: string[]; equals: string };
            materialId?: { in: string[] };
          };
          data: { promotionState: string };
        };
        writes.push({ where, data });
        let count = 0;
        for (const row of rows) {
          if (row.promotionState !== where.promotionState) continue;
          if (where.sourceRef && pageIdOf(row) !== where.sourceRef.equals) continue;
          if (where.materialId && !where.materialId.in.includes(row.materialId)) continue;
          row.promotionState = data.promotionState;
          count++;
        }
        return { count };
      },
    },
    wikiPage: {
      async findMany(args: unknown) {
        const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
        return pages.filter((page) => ids.includes(page.id));
      },
    },
  };
  return { db, rows, writes };
}

const state = (rows: Row[], materialId: string) => rows.find((row) => row.materialId === materialId)?.promotionState;

describe("promotionForPageStatus", () => {
  it("is gate-live only while the page is published", () => {
    expect(promotionForPageStatus("published")).toBe("promoted");
    expect(promotionForPageStatus("archived")).toBe("revoked");
    expect(promotionForPageStatus("draft")).toBe("revoked");
    expect(promotionForPageStatus("review-needed")).toBe("revoked");
  });
});

describe("syncPageMaterialToStatus", () => {
  it("revokes every promoted row sourced from a page that left published", async () => {
    const { db, rows } = fakeDb(
      [
        { materialId: "m-primary", promotionState: "promoted", sourceRef: { wikiPageId: "page-1" } },
        { materialId: "m-secondary", promotionState: "promoted", sourceRef: { wikiPageId: "page-1" } },
        { materialId: "m-other-page", promotionState: "promoted", sourceRef: { wikiPageId: "page-2" } },
      ],
      [],
    );

    const result = await syncPageMaterialToStatus({ db, pageId: "page-1", pageStatus: "archived" });

    expect(result).toEqual({ promotionState: "revoked", changed: 2 });
    expect(state(rows, "m-primary")).toBe("revoked");
    expect(state(rows, "m-secondary")).toBe("revoked");
    expect(state(rows, "m-other-page")).toBe("promoted");
  });

  it("restores the page's revoked rows when it is published again", async () => {
    const { db, rows } = fakeDb(
      [{ materialId: "m-1", promotionState: "revoked", sourceRef: { wikiPageId: "page-1" } }],
      [],
    );

    const result = await syncPageMaterialToStatus({ db, pageId: "page-1", pageStatus: "published" });

    expect(result).toEqual({ promotionState: "promoted", changed: 1 });
    expect(state(rows, "m-1")).toBe("promoted");
  });

  it("never touches candidate material in either direction", async () => {
    const { db, rows } = fakeDb(
      [{ materialId: "m-candidate", promotionState: "candidate", sourceRef: { wikiPageId: "page-1" } }],
      [],
    );

    await syncPageMaterialToStatus({ db, pageId: "page-1", pageStatus: "archived" });
    await syncPageMaterialToStatus({ db, pageId: "page-1", pageStatus: "published" });

    expect(state(rows, "m-candidate")).toBe("candidate");
  });
});

describe("planPageMaterialRevocations", () => {
  it("revokes material whose page exists and is not published, and nothing else", () => {
    const statusById = new Map([
      ["archived-page", "archived"],
      ["draft-page", "draft"],
      ["live-page", "published"],
    ]);

    const plan = planPageMaterialRevocations(
      [
        { materialId: "m-archived", wikiPageId: "archived-page" },
        { materialId: "m-draft", wikiPageId: "draft-page" },
        { materialId: "m-live", wikiPageId: "live-page" },
        // Absence is ambiguous (a kernel re-seed in flight, a partial load):
        // acting on it could mass-revoke doctrine, so it is left alone.
        { materialId: "m-missing", wikiPageId: "missing-page" },
      ],
      statusById,
    );

    expect(plan).toEqual(["m-archived", "m-draft"]);
  });
});

describe("reconcilePageMaterialToStatus", () => {
  const seed = () =>
    fakeDb(
      [
        { materialId: "m-archived", promotionState: "promoted", sourceRef: { wikiPageId: "archived-page" } },
        { materialId: "m-live", promotionState: "promoted", sourceRef: { wikiPageId: "live-page" } },
        { materialId: "m-kernel-doc", promotionState: "promoted", sourceRef: { path: "docs/founder-kernel/x.md" } },
        { materialId: "m-revoked-live", promotionState: "revoked", sourceRef: { wikiPageId: "live-page" } },
      ],
      [
        { id: "archived-page", status: "archived" },
        { id: "live-page", status: "published" },
      ],
    );

  it("revokes promoted material backed by an unpublished page", async () => {
    const { db, rows } = seed();

    const result = await reconcilePageMaterialToStatus({ db });

    expect(result).toEqual({ examined: 2, revoked: ["m-archived"], dryRun: false });
    expect(state(rows, "m-archived")).toBe("revoked");
    expect(state(rows, "m-live")).toBe("promoted");
    expect(state(rows, "m-kernel-doc")).toBe("promoted");
  });

  it("never restores authority, even for revoked material behind a published page", async () => {
    const { db, rows, writes } = seed();

    await reconcilePageMaterialToStatus({ db });

    expect(state(rows, "m-revoked-live")).toBe("revoked");
    expect(writes.every((write) => (write.data as { promotionState: string }).promotionState === "revoked")).toBe(true);
  });

  it("reports the plan and writes nothing on a dry run", async () => {
    const { db, rows, writes } = seed();

    const result = await reconcilePageMaterialToStatus({ db, dryRun: true });

    expect(result).toEqual({ examined: 2, revoked: ["m-archived"], dryRun: true });
    expect(writes).toEqual([]);
    expect(state(rows, "m-archived")).toBe("promoted");
  });
});

describe("syncPageMaterialAfterTransition", () => {
  it("logs a failed sync instead of failing the status change that already committed", async () => {
    const warnings: string[] = [];
    const db = {
      perspectiveMaterial: {
        findMany: async () => [],
        updateMany: async () => {
          throw new Error("db down");
        },
      },
    };

    const result = await syncPageMaterialAfterTransition({
      db,
      pageId: "page-1",
      pageStatus: "archived",
      origin: "wiki-edit",
      logger: { warn: (message: string) => warnings.push(message) },
    });

    expect(result).toBeNull();
    expect(warnings).toEqual([expect.stringContaining("page-1")]);
  });
});
