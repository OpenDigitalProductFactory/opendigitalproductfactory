// BI-3045CC18: the knowledge corpus reaches the graph mirror through syncWikiPage
// / syncWikiPageLink. Mock the client seam and assert on the SQL that lands.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock("../src/client", () => ({
  prisma: {
    $executeRawUnsafe: execMock,
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    taxonomyNode: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { syncWikiPage, syncWikiPageLink, wikiPageLabel } from "../src/graph-sync";

beforeEach(() => {
  execMock.mockReset();
  execMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function findNodeUpsert() {
  const call = execMock.mock.calls.find(
    ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO graph_node"),
  );
  expect(call).toBeDefined();
  const [, key, labels, propsJson] = call as [string, string, string[], string];
  return { key, labels, props: JSON.parse(propsJson) as Record<string, unknown> };
}

function findEdgeUpserts() {
  return execMock.mock.calls
    .filter(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO graph_edge"))
    .map((call) => {
      const [, srcKey, dstKey, relType] = call as [string, string, string, string];
      return { srcKey, dstKey, relType };
    });
}

const BASE_PAGE = {
  id: "wp_principle_1",
  slug: "never-wipe-db",
  title: "Never wipe the DB to fix code",
  pageKind: "principle",
  status: "published",
  isKernel: true,
  organizationId: null,
  kernelPageId: null,
};

describe("wikiPageLabel", () => {
  it("maps a page kind to its namespaced storage label", () => {
    expect(wikiPageLabel("principle")).toBe("Wiki__Principle");
    expect(wikiPageLabel("stance")).toBe("Wiki__Stance");
  });

  it("normalises a multi-word or oddly-cased kind", () => {
    expect(wikiPageLabel("field guide")).toBe("Wiki__FieldGuide");
    expect(wikiPageLabel("RUNBOOK")).toBe("Wiki__Runbook");
  });

  it("still yields a well-formed label for an empty kind", () => {
    // pageKind is a plain string in the schema, so this must not produce the
    // bare prefix "Wiki__", which would humanize to an empty display name.
    expect(wikiPageLabel("")).toBe("Wiki__Page");
  });
});

describe("syncWikiPage", () => {
  it("keys the node by id, not slug", async () => {
    // WikiPage is unique on (organizationId, slug), so a slug is ambiguous between
    // the kernel page and each organization's overlay of it.
    await syncWikiPage(BASE_PAGE);
    expect(findNodeUpsert().key).toBe("wp_principle_1");
  });

  it("writes exactly ONE label per node", async () => {
    // Load-bearing: the explorer census sums per-label counts, so a node carrying
    // both a generic marker and a specific kind is counted twice — the reason
    // EaElement needs a hard-coded skip on the read side. One label keeps the
    // knowledge domain out of that trap.
    await syncWikiPage(BASE_PAGE);
    expect(findNodeUpsert().labels).toEqual(["Wiki__Principle"]);
  });

  it("carries the title under `name` so cross-domain search finds it", async () => {
    await syncWikiPage(BASE_PAGE);
    const { props } = findNodeUpsert();
    expect(props).toMatchObject({
      name: "Never wipe the DB to fix code",
      title: "Never wipe the DB to fix code",
      slug: "never-wipe-db",
      pageKind: "principle",
      status: "published",
      isKernel: true,
    });
  });

  it("writes an OVERRIDES edge when the page refines a kernel page", async () => {
    await syncWikiPage({
      ...BASE_PAGE,
      id: "wp_org_override",
      isKernel: false,
      organizationId: "org_1",
      kernelPageId: "wp_principle_1",
    });
    expect(findEdgeUpserts()).toContainEqual({
      srcKey: "wp_org_override",
      dstKey: "wp_principle_1",
      relType: "OVERRIDES",
    });
  });

  it("writes no edge when the page is not an override", async () => {
    await syncWikiPage(BASE_PAGE);
    expect(findEdgeUpserts()).toHaveLength(0);
  });
});

describe("syncWikiPageLink", () => {
  it("writes a directed LINKS_TO edge", async () => {
    await syncWikiPageLink({ fromPageId: "wp_a", toPageId: "wp_b" });
    expect(findEdgeUpserts()).toEqual([
      { srcKey: "wp_a", dstKey: "wp_b", relType: "LINKS_TO" },
    ]);
  });
});
