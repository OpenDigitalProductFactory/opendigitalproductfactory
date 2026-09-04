// BI-F9CAF214: the committed-schema reader must never answer anonymously, and
// must never let a read failure look like an absence.
import { describe, it, expect, vi, afterEach } from "vitest";

import { loadCommittedSchema, SCHEMA_DIR_RELATIVE } from "./committed-schema-source";

const readdir = vi.fn();
const readFile = vi.fn();

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyFsPromises: () => ({ readdir, readFile }),
  lazyPath: () => ({ resolve: (...parts: string[]) => parts.join("/") }),
  lazyExec: () => async () => {
    throw new Error("no git in this fixture");
  },
  getCwd: () => "/cwd",
}));

const readGit = vi.fn(async () => "main");

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PROJECT_ROOT;
});

describe("loadCommittedSchema", () => {
  it("returns null when the schema directory cannot be read — a read failure, not an absence", async () => {
    readdir.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await loadCommittedSchema({ skipDefaultBranch: true, readGit })).toBeNull();
  });

  it("returns null when the directory holds no .prisma files", async () => {
    readdir.mockResolvedValueOnce(["README.md"]);
    expect(await loadCommittedSchema({ skipDefaultBranch: true, readGit })).toBeNull();
  });

  it("joins every domain file and reports provenance naming the tree", async () => {
    process.env.PROJECT_ROOT = "/repo";
    readdir.mockResolvedValueOnce(["b.prisma", "a.prisma"]);
    readFile.mockResolvedValueOnce("model A {}").mockResolvedValueOnce("model B {}");

    const result = await loadCommittedSchema({ skipDefaultBranch: true, readGit });

    expect(result).not.toBeNull();
    expect(result!.provenance.tree).toBe("committed");
    expect(result!.provenance.root).toBe(`/repo`);
    expect(result!.provenance.schemaFileCount).toBe(2);
    // sorted: a.prisma read before b.prisma
    expect(result!.schema).toBe("model A {}\nmodel B {}");
    expect(SCHEMA_DIR_RELATIVE).toBe("packages/db/prisma/schema");
  });

  it("carries a trust vector that names the branch", async () => {
    readdir.mockResolvedValueOnce(["a.prisma"]);
    readFile.mockResolvedValueOnce("model A {}");

    const result = await loadCommittedSchema({ skipDefaultBranch: true, readGit });

    expect(result!.trust.kind).toBe("data-trust-vector");
    expect(result!.trust.subject.type).toBe("committed-schema");
    const freshness = result!.trust.dimensions.find((d) => d.key === "freshness");
    expect(freshness?.rationale).toContain("main");
  });
});
