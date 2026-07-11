import { beforeEach, describe, expect, it, vi } from "vitest";

const gitUtils = vi.hoisted(() => ({
  isGitAvailable: vi.fn(),
  gitShow: vi.fn(),
  gitGrep: vi.fn(),
  gitLsTree: vi.fn(),
  gitDiffStat: vi.fn(),
  gitLog: vi.fn(),
}));
vi.mock("@/lib/git-utils", () => gitUtils);

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

  it("read_source_at_version returns file content via gitShow", async () => {
    gitUtils.gitShow.mockResolvedValue({ content: "export const x = 1;" });
    const res = await versionHistoryPack.handlers.read_source_at_version(
      { path: "apps/web/x.ts", version: "v1.0.0" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("export const x = 1;");
    expect(gitUtils.gitShow).toHaveBeenCalledWith({ ref: "v1.0.0", path: "apps/web/x.ts" });
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

  it("search_source_at_version forwards glob + maxResults to gitGrep and formats hits", async () => {
    gitUtils.gitGrep.mockResolvedValue({ results: [{ path: "a.ts", line: 4, text: "hit" }] });
    const res = await versionHistoryPack.handlers.search_source_at_version(
      { query: "hit", glob: "*.ts", maxResults: 7 },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("a.ts:4: hit");
    expect(gitUtils.gitGrep).toHaveBeenCalledWith({ query: "hit", ref: "HEAD", glob: "*.ts", maxResults: 7 });
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
