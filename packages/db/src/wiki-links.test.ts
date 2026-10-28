import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ prisma: {} }));

import {
  reconcileWikiPageLinks,
  replaceWikiPageOutLinks,
  type WikiLinkClient,
} from "./wiki-links";

// BI-23900D0A. The page body is the system of record for its out-links; these
// tests hold the writer to "the rows equal what the body says", every time.

type Page = { id: string; slug: string; organizationId: string | null; isKernel: boolean; body: string };
type Link = { fromPageId: string; toPageId: string };

function fakeDb(pages: Page[], links: Link[] = []) {
  const state = { pages, links: [...links] };
  const db: WikiLinkClient = {
    wikiPage: {
      findMany: vi.fn(async (args: {
        where?: {
          slug?: { in: string[] };
          OR?: Array<{ organizationId: string | null }>;
          organizationId?: null;
          id?: { gt: string };
        };
        take?: number;
      }) => {
        const w = args.where ?? {};
        let rows = state.pages.filter((p) => {
          if (w.slug && !w.slug.in.includes(p.slug)) return false;
          if (w.OR && !w.OR.some((c) => c.organizationId === p.organizationId)) return false;
          if (w.organizationId === null && p.organizationId !== null) return false;
          if (w.id && !(p.id > w.id.gt)) return false;
          return true;
        });
        rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        return args.take ? rows.slice(0, args.take) : rows;
      }),
    },
    wikiPageLink: {
      findMany: vi.fn(async (args: { where: { fromPageId: string } }) =>
        state.links.filter((l) => l.fromPageId === args.where.fromPageId).map((l) => ({ toPageId: l.toPageId })),
      ),
      deleteMany: vi.fn(async (args: { where: { fromPageId: string; toPageId: { in: string[] } } }) => {
        const before = state.links.length;
        state.links = state.links.filter(
          (l) => !(l.fromPageId === args.where.fromPageId && args.where.toPageId.in.includes(l.toPageId)),
        );
        return { count: before - state.links.length };
      }),
      createMany: vi.fn(async (args: { data: Link[] }) => {
        state.links.push(...args.data);
        return { count: args.data.length };
      }),
    },
  };
  return { db, state };
}

const kernel = (slug: string, body = ""): Page => ({ id: `k:${slug}`, slug, organizationId: null, isKernel: true, body });
const profession = (slug: string, body = ""): Page => ({ id: `p:${slug}`, slug, organizationId: null, isKernel: false, body });
const overlay = (org: string, slug: string, body = ""): Page => ({ id: `${org}:${slug}`, slug, organizationId: org, isKernel: false, body });

describe("replaceWikiPageOutLinks", () => {
  it("stores a labelled link and projects it", async () => {
    const { db, state } = fakeDb([kernel("a", "See [[b|the b page]]."), kernel("b")]);
    const project = vi.fn(async () => undefined);

    await replaceWikiPageOutLinks(db, { pageId: "k:a", organizationId: null, body: "See [[b|the b page]]." }, project);

    expect(state.links).toEqual([{ fromPageId: "k:a", toPageId: "k:b" }]);
    expect(project).toHaveBeenCalledWith("k:a", ["k:b"]);
  });

  it("resolves an organization page's link to a kernel page and to a profession page", async () => {
    const body = "Builds on [[principles/x]] and [[professions/hr/y]].";
    const { db, state } = fakeDb([
      overlay("org1", "stances/s", body),
      kernel("principles/x"),
      profession("professions/hr/y"),
    ]);

    await replaceWikiPageOutLinks(db, { pageId: "org1:stances/s", organizationId: "org1", body }, async () => undefined);

    expect(state.links.map((l) => l.toPageId).sort()).toEqual(["k:principles/x", "p:professions/hr/y"]);
  });

  it("prefers the page's own organization over the kernel for the same slug", async () => {
    const { db, state } = fakeDb([
      overlay("org1", "stances/s"),
      overlay("org1", "principles/x"),
      kernel("principles/x"),
      overlay("org2", "principles/x"),
    ]);

    await replaceWikiPageOutLinks(db, { pageId: "org1:stances/s", organizationId: "org1", body: "[[principles/x]]" }, async () => undefined);

    expect(state.links).toEqual([{ fromPageId: "org1:stances/s", toPageId: "org1:principles/x" }]);
  });

  it("never resolves a slug to another organization's page", async () => {
    const { db, state } = fakeDb([overlay("org1", "a"), overlay("org2", "only-in-org2")]);

    await replaceWikiPageOutLinks(db, { pageId: "org1:a", organizationId: "org1", body: "[[only-in-org2]]" }, async () => undefined);

    expect(state.links).toEqual([]);
  });

  it("removes the row and the edge of a link deleted from the body", async () => {
    const { db, state } = fakeDb([kernel("a"), kernel("b"), kernel("c")], [
      { fromPageId: "k:a", toPageId: "k:b" },
      { fromPageId: "k:a", toPageId: "k:c" },
    ]);
    const project = vi.fn(async () => undefined);

    const result = await replaceWikiPageOutLinks(db, { pageId: "k:a", organizationId: null, body: "Only [[c]] now." }, project);

    expect(state.links).toEqual([{ fromPageId: "k:a", toPageId: "k:c" }]);
    expect(result).toMatchObject({ added: 0, removed: 1 });
    expect(project).toHaveBeenCalledWith("k:a", ["k:c"]);
  });

  it("skips self-links, dangling slugs and raw-source citations", async () => {
    const { db, state } = fakeDb([kernel("a"), kernel("raw-sources/papers/p")]);

    await replaceWikiPageOutLinks(
      db,
      { pageId: "k:a", organizationId: null, body: "[[a]] [[missing]] [[raw-sources/papers/p]]" },
      async () => undefined,
    );

    expect(state.links).toEqual([]);
  });

  it("does not let a projection failure undo the stored rows", async () => {
    const { db, state } = fakeDb([kernel("a"), kernel("b")]);

    const result = await replaceWikiPageOutLinks(db, { pageId: "k:a", organizationId: null, body: "[[b]]" }, async () => {
      throw new Error("graph mirror unavailable");
    });

    expect(state.links).toEqual([{ fromPageId: "k:a", toPageId: "k:b" }]);
    expect(result.projectionError).toContain("graph mirror unavailable");
  });
});

describe("reconcileWikiPageLinks (backfill)", () => {
  it("brings every page's rows in line with its body, and a second run changes nothing", async () => {
    const { db, state } = fakeDb(
      [
        kernel("a", "[[b|labelled]] and [[c]]"),
        kernel("b", "no links"),
        kernel("c", "[[a]]"),
        overlay("org1", "s", "[[a]]"),
      ],
      [
        { fromPageId: "k:b", toPageId: "k:c" }, // stale: b's body links nothing
      ],
    );
    const project = vi.fn(async () => undefined);

    const first = await reconcileWikiPageLinks(db, { pageSize: 2, project });
    const rows = state.links.map((l) => `${l.fromPageId}->${l.toPageId}`).sort();
    expect(rows).toEqual(["k:a->k:b", "k:a->k:c", "k:c->k:a", "org1:s->k:a"]);
    expect(first).toEqual({ pages: 4, added: 4, removed: 1, projectionErrors: 0 });

    const second = await reconcileWikiPageLinks(db, { pageSize: 2, project });
    expect(second).toEqual({ pages: 4, added: 0, removed: 0, projectionErrors: 0 });
    expect(state.links.map((l) => `${l.fromPageId}->${l.toPageId}`).sort()).toEqual(rows);
  });
});
