import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  organization: { findFirst: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

const embeddings = vi.hoisted(() => ({ searchWikiPages: vi.fn() }));
vi.mock("@/lib/wiki/embeddings", () => ({
  searchWikiPages: (...a: unknown[]) => embeddings.searchWikiPages(...a),
}));

const lint = vi.hoisted(() => ({ runWikiLint: vi.fn() }));
vi.mock("@/lib/wiki/lint", () => ({
  runWikiLint: (...a: unknown[]) => lint.runWikiLint(...a),
}));

const ingest = vi.hoisted(() => ({ assertAllowedIngestPath: vi.fn() }));
vi.mock("@/lib/wiki/ingest", () => ({
  assertAllowedIngestPath: (...a: unknown[]) => ingest.assertAllowedIngestPath(...a),
}));

const pipeline = vi.hoisted(() => ({
  runIngestPipeline: vi.fn(),
  summarizePipelineResult: vi.fn(),
}));
vi.mock("@/lib/wiki/ingest-pipeline", () => ({
  runIngestPipeline: (...a: unknown[]) => pipeline.runIngestPipeline(...a),
  summarizePipelineResult: (...a: unknown[]) => pipeline.summarizePipelineResult(...a),
}));

vi.mock("@/lib/wiki/inference-adapter", () => ({
  createProductionInference: () => vi.fn(),
}));

import { wikiPack } from "./wiki-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["wiki_query", "wiki_lint", "wiki_ingest"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wiki pack — registration", () => {
  it("exposes exactly the three tools with a handler each", () => {
    expect(wikiPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(wikiPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("uses packId 'wiki' (no collision with wiki-overlay)", () => {
    expect(wikiPack.packId).toBe("wiki");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of wikiPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    expect(wikiPack.grants.wiki_query).toEqual(["registry_read"]);
    expect(wikiPack.grants.wiki_lint).toEqual(["registry_read"]);
    expect(wikiPack.grants.wiki_ingest).toEqual(["registry_write"]);

    expect(isToolAllowedByGrants("wiki_query", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("wiki_lint", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("wiki_ingest", ["registry_write"])).toBe(true);
  });
});

describe("wiki pack — handler behavior (delegation preserved)", () => {
  it("wiki_query delegates to searchWikiPages and reports no matches when empty", async () => {
    db.organization.findFirst.mockResolvedValue({ id: "org-1", wikiRetrievalMode: "vector" });
    embeddings.searchWikiPages.mockResolvedValue([]);
    const res = await wikiPack.handlers.wiki_query({ query: "kernel" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.message).toContain("No matching wiki pages found");
    expect(embeddings.searchWikiPages).toHaveBeenCalledTimes(1);
  });

  it("wiki_query includes the WSID profession corpus by default and maps professionKey (BI-CC44E74F)", async () => {
    db.organization.findFirst.mockResolvedValue({ id: "org-1", wikiRetrievalMode: "vector" });
    embeddings.searchWikiPages.mockResolvedValue([]);
    await wikiPack.handlers.wiki_query({ query: "referential integrity" }, "u1", {});
    expect(embeddings.searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ includeProfessionCorpus: true, professionKeys: undefined }),
    );

    embeddings.searchWikiPages.mockClear();
    await wikiPack.handlers.wiki_query(
      { query: "referential integrity", professionKey: "data-architect" },
      "u1",
      {},
    );
    expect(embeddings.searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ professionKeys: ["data-architect"] }),
    );

    embeddings.searchWikiPages.mockClear();
    await wikiPack.handlers.wiki_query(
      { query: "referential integrity", includeProfessionCorpus: false },
      "u1",
      {},
    );
    expect(embeddings.searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ includeProfessionCorpus: false }),
    );
  });

  it("wiki_lint reports no scope linted when scope=org and no org exists", async () => {
    db.organization.findFirst.mockResolvedValue(null);
    const res = await wikiPack.handlers.wiki_lint({ scope: "org" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.message).toContain("No scope linted");
    expect(lint.runWikiLint).not.toHaveBeenCalled();
  });

  it("wiki_ingest rejects when filePath is missing, before touching the pipeline", async () => {
    const res = await wikiPack.handlers.wiki_ingest({}, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("Missing filePath");
    expect(ingest.assertAllowedIngestPath).not.toHaveBeenCalled();
    expect(pipeline.runIngestPipeline).not.toHaveBeenCalled();
  });

  it("wiki_ingest rejects a path outside the allowed roots", async () => {
    ingest.assertAllowedIngestPath.mockImplementation(() => {
      throw new Error("path outside allowed roots");
    });
    const res = await wikiPack.handlers.wiki_ingest({ filePath: "/etc/passwd" }, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("path_not_allowed");
    expect(pipeline.runIngestPipeline).not.toHaveBeenCalled();
  });
});
