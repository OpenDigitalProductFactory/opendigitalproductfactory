import { beforeEach, describe, expect, it, vi } from "vitest";

const gitUtils = vi.hoisted(() => ({
  isGitAvailable: vi.fn(),
  gitShow: vi.fn(),
  gitBlobId: vi.fn(),
  gitGrep: vi.fn(),
  gitLsTree: vi.fn(),
  gitDiffStat: vi.fn(),
  gitLog: vi.fn(),
}));
vi.mock("@/lib/git-utils", () => gitUtils);

const repositoryArtifact = vi.hoisted(() => ({
  readRepositoryProviderBlob: vi.fn(),
}));
vi.mock("@/lib/backlog/initiative-readiness/repository-artifact", () => repositoryArtifact);

const db = vi.hoisted(() => ({
  prisma: {
    productVersion: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@dpf/db", () => db);

import { versionHistoryPack } from "./version-history-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "query_version_history",
  "read_source_at_version",
  "search_source_at_version",
  "list_source_directory",
  "compare_versions",
];

beforeEach(() => {
  vi.clearAllMocks();
  gitUtils.isGitAvailable.mockResolvedValue(true);
  gitUtils.gitBlobId.mockResolvedValue({ blobId: "blob-1" });
  repositoryArtifact.readRepositoryProviderBlob.mockResolvedValue({
    ok: false,
    code: "IMMUTABLE_SOURCE_UNAVAILABLE",
    error: "provider unavailable",
  });
});

describe("version-history pack — registration", () => {
  it("exposes exactly the five version-history tools", () => {
    expect(versionHistoryPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(versionHistoryPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of versionHistoryPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: every tool needs file_read", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(versionHistoryPack.grants[t]).toEqual(["file_read"]);
      expect(isToolAllowedByGrants(t, ["file_read"])).toBe(true);
    }
  });

  it("retains only the immutable reader's normalized audit parameters", () => {
    const retained = versionHistoryPack.definitions
      .filter((definition) => definition.retainAuditParameters)
      .map((definition) => definition.name);

    expect(retained).toEqual(["read_source_at_version"]);
  });
});

describe("version-history pack — handler behavior (delegation preserved)", () => {
  it("query_version_history summarizes product versions from prisma", async () => {
    db.prisma.productVersion.findMany.mockResolvedValue([
      {
        digitalProduct: { name: "Widget", productId: "P-1" },
        version: "1.2.0",
        gitTag: "v1.2.0",
        shippedAt: new Date("2026-01-05T00:00:00.000Z"),
        changeCount: 3,
        changeSummary: "fixes",
        promotions: [{ status: "promoted", promotionId: "PR-1" }],
      },
    ]);
    const res = await versionHistoryPack.handlers.query_version_history({ limit: 10 }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Widget 1.2.0 (v1.2.0)");
    expect(res.message).toContain("promoted");
    expect(res.message).toContain("shipped 2026-01-05");
    const arg = db.prisma.productVersion.findMany.mock.calls[0][0];
    expect(arg.take).toBe(10);
    expect(arg.where).toEqual({});
  });

  it("query_version_history filters by digitalProductId and caps the limit at 50", async () => {
    db.prisma.productVersion.findMany.mockResolvedValue([]);
    const res = await versionHistoryPack.handlers.query_version_history(
      { digitalProductId: "P-9", limit: 999 },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("No versions found.");
    const arg = db.prisma.productVersion.findMany.mock.calls[0][0];
    expect(arg.take).toBe(50);
    expect(arg.where).toEqual({ digitalProductId: "P-9" });
  });

  it("read_source_at_version returns one bounded content page with continuation metadata", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "one\ntwo\nthree\n" });
    const first = await versionHistoryPack.handlers.read_source_at_version(
      {
        path: "apps/web/x.ts",
        version: "v1.0.0",
        expectedBlobId: "blob-1",
        maxLines: 2,
        maxChars: 100,
      },
      "u1",
    );
    expect(first.success).toBe(true);
    expect(first.message).toBe("Read apps/web/x.ts lines 1-2 of 3 at v1.0.0 (more available).");
    expect(first.message).not.toContain("one");
    expect(first.data).toMatchObject({
      path: "apps/web/x.ts",
      version: "v1.0.0",
      blobId: "blob-1",
      content: "one\ntwo\n",
      startLine: 1,
      endLine: 2,
      totalLines: 3,
      hasMore: true,
    });
    const nextCursor = (first.data as { nextCursor?: string }).nextCursor;
    expect(nextCursor).toEqual(expect.any(String));

    const second = await versionHistoryPack.handlers.read_source_at_version(
      {
        path: "apps/web/x.ts",
        version: "v1.0.0",
        expectedBlobId: "blob-1",
        cursor: nextCursor,
        maxLines: 2,
        maxChars: 100,
      },
      "u1",
    );
    expect(second.data).toMatchObject({
      content: "three\n",
      startLine: 3,
      endLine: 3,
      totalLines: 3,
      hasMore: false,
      nextCursor: null,
    });
    expect(gitUtils.gitBlobId).toHaveBeenCalledWith({ ref: "v1.0.0", path: "apps/web/x.ts" });
    expect(gitUtils.gitShow).toHaveBeenCalledWith({ ref: "v1.0.0", path: "apps/web/x.ts" });
  });

  it("read_source_at_version cursor makes progress through a line longer than maxChars", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "abcdefghij\nlast\n" });
    const first = await versionHistoryPack.handlers.read_source_at_version(
      { path: "long.md", maxLines: 5, maxChars: 5 },
      "u1",
    );
    expect(first.data).toMatchObject({ content: "abcde", startLine: 1, endLine: 1, hasMore: true });
    const second = await versionHistoryPack.handlers.read_source_at_version(
      { path: "long.md", cursor: (first.data as { nextCursor: string }).nextCursor, maxLines: 5, maxChars: 5 },
      "u1",
    );
    expect(second.data).toMatchObject({ content: "fghij", startLine: 1, endLine: 1, hasMore: true });
  });

  it("read_source_at_version supports a direct line jump", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "one\ntwo\nthree\n" });
    const res = await versionHistoryPack.handlers.read_source_at_version(
      { path: "x.md", startLine: 3, maxLines: 1, maxChars: 100 },
      "u1",
    );
    expect(res.data).toMatchObject({ content: "three\n", startLine: 3, endLine: 3, hasMore: false });
  });

  it("read_source_at_version rejects a cursor replayed against another artifact", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "one\ntwo\n" });
    const first = await versionHistoryPack.handlers.read_source_at_version(
      { path: "first.md", version: "abc", maxLines: 1, maxChars: 100 },
      "u1",
    );
    const replay = await versionHistoryPack.handlers.read_source_at_version(
      { path: "second.md", version: "abc", cursor: (first.data as { nextCursor: string }).nextCursor },
      "u1",
    );
    expect(replay).toMatchObject({ success: false, error: "invalid_cursor" });
  });

  it("read_source_at_version rejects an unexpected immutable blob before reading bytes", async () => {
    gitUtils.gitBlobId.mockResolvedValue({ blobId: "actual-blob" });
    const res = await versionHistoryPack.handlers.read_source_at_version(
      { path: "x.md", version: "abc", expectedBlobId: "expected-blob" },
      "u1",
    );
    expect(res).toMatchObject({ success: false, error: "immutable_blob_mismatch" });
    expect(gitUtils.gitShow).not.toHaveBeenCalled();
  });

  it("read_source_at_version returns file content via gitShow for a short legacy call", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "export const x = 1;" });
    const res = await versionHistoryPack.handlers.read_source_at_version(
      { path: "apps/web/x.ts", version: "v1.0.0" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect((res.data as { content: string }).content).toBe("export const x = 1;");
    expect(res.message).not.toContain("export const x");
    expect(gitUtils.gitShow).toHaveBeenCalledWith({ ref: "v1.0.0", path: "apps/web/x.ts" });
  });

  it("reads an exact provider blob when the live git volume lacks the bound commit", async () => {
    gitUtils.gitBlobId.mockResolvedValue({ error: "unknown revision" });
    repositoryArtifact.readRepositoryProviderBlob.mockResolvedValue({
      ok: true,
      data: Buffer.from("remote immutable bytes\n", "utf8"),
    });
    const res = await versionHistoryPack.handlers.read_source_at_version({
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      path: "docs/spec.md",
      version: "a".repeat(40),
      expectedBlobId: "b".repeat(40),
    }, "u1");

    expect(res).toMatchObject({
      success: true,
      data: {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        path: "docs/spec.md",
        version: "a".repeat(40),
        blobId: "b".repeat(40),
        content: "remote immutable bytes\n",
      },
    });
    expect(repositoryArtifact.readRepositoryProviderBlob).toHaveBeenCalledWith({
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "a".repeat(40),
      path: "docs/spec.md",
      expectedBlobId: "b".repeat(40),
    });
    expect(gitUtils.gitShow).not.toHaveBeenCalled();
  });

  it("fails closed instead of falling back without a complete immutable provider identity", async () => {
    gitUtils.gitBlobId.mockResolvedValue({ error: "unknown revision" });
    const res = await versionHistoryPack.handlers.read_source_at_version({
      path: "docs/spec.md",
      version: "a".repeat(40),
      expectedBlobId: "b".repeat(40),
    }, "u1");

    expect(res).toMatchObject({ success: false, error: "unknown revision" });
    expect(repositoryArtifact.readRepositoryProviderBlob).not.toHaveBeenCalled();
  });

  it("read_source_at_version surfaces a git error", async () => {
    gitUtils.gitShow.mockResolvedValue({ error: "no such path" });
    const res = await versionHistoryPack.handlers.read_source_at_version({ path: "nope.ts" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("no such path");
  });

  it("all git tools short-circuit when git history is unavailable", async () => {
    gitUtils.isGitAvailable.mockResolvedValue(false);
    for (const t of ["read_source_at_version", "search_source_at_version", "list_source_directory", "compare_versions"]) {
      const res = await versionHistoryPack.handlers[t]({ path: "x", query: "x", from: "a" }, "u1");
      expect(res.success, t).toBe(false);
      expect(res.message, t).toBe("Git not available.");
    }
  });

  it("search_source_at_version returns a deterministic page and continuation offset", async () => {
    gitUtils.gitGrep.mockResolvedValue({ results: [
      { path: "a.ts", line: 1, text: "hit-1" },
      { path: "a.ts", line: 2, text: "hit-2" },
      { path: "a.ts", line: 3, text: "hit-3" },
      { path: "a.ts", line: 4, text: "hit-4" },
    ] });
    const res = await versionHistoryPack.handlers.search_source_at_version(
      { query: "hit", glob: "a.ts", offset: 1, maxResults: 2, expectedBlobId: "blob-1" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("Found 2 matches at HEAD (more available).");
    expect(res.message).not.toContain("hit-2");
    expect(res.data).toMatchObject({
      results: [
        { path: "a.ts", line: 2, text: "hit-2" },
        { path: "a.ts", line: 3, text: "hit-3" },
      ],
      offset: 1,
      hasMore: true,
      nextOffset: 3,
      blobId: "blob-1",
    });
    expect(gitUtils.gitGrep).toHaveBeenCalledWith({ query: "hit", ref: "HEAD", glob: "a.ts", maxResults: 4 });
  });

  it("bound source schemas expose range, continuation, and blob identity inputs", () => {
    const read = versionHistoryPack.definitions.find((tool) => tool.name === "read_source_at_version")!;
    expect(read.inputSchema.properties).toEqual(expect.objectContaining({
      startLine: expect.objectContaining({ type: "number" }),
      cursor: expect.objectContaining({ type: "string" }),
      maxLines: expect.objectContaining({ type: "number" }),
      maxChars: expect.objectContaining({ type: "number" }),
      expectedBlobId: expect.objectContaining({ type: "string" }),
    }));
    const search = versionHistoryPack.definitions.find((tool) => tool.name === "search_source_at_version")!;
    expect(search.inputSchema.properties).toEqual(expect.objectContaining({
      offset: expect.objectContaining({ type: "number" }),
      expectedBlobId: expect.objectContaining({ type: "string" }),
    }));
  });

  it("list_source_directory renders entries with type icons", async () => {
    gitUtils.gitLsTree.mockResolvedValue({
      entries: [{ type: "dir", path: "apps" }, { type: "file", path: "README.md" }],
    });
    const res = await versionHistoryPack.handlers.list_source_directory({ path: "" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("📁 apps");
    expect(res.message).toContain("📄 README.md");
  });

  it("compare_versions combines diff stat and commit log", async () => {
    gitUtils.gitDiffStat.mockResolvedValue({ filesChanged: 2, summary: "2 files changed" });
    gitUtils.gitLog.mockResolvedValue({ commits: [{ hash: "abc", subject: "fix" }] });
    const res = await versionHistoryPack.handlers.compare_versions({ from: "v1", to: "v2" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("2 files changed");
    expect((res.data as { filesChanged: number }).filesChanged).toBe(2);
    expect(gitUtils.gitDiffStat).toHaveBeenCalledWith({ from: "v1", to: "v2" });
    expect(gitUtils.gitLog).toHaveBeenCalledWith({ from: "v1", to: "v2", maxCount: 20 });
  });
});
