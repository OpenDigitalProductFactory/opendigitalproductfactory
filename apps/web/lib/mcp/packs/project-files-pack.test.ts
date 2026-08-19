import { beforeEach, describe, expect, it, vi } from "vitest";

const codebaseTools = vi.hoisted(() => ({
  listProjectDirectory: vi.fn(),
  readProjectFile: vi.fn(),
  searchProjectFiles: vi.fn(),
  isDevInstance: vi.fn(),
}));
vi.mock("@/lib/build/codebase-tools", () => codebaseTools);

const manifestGenerator = vi.hoisted(() => ({ generateManifest: vi.fn() }));
vi.mock("@/lib/manifest-generator", () => manifestGenerator);

const gitUtils = vi.hoisted(() => ({ getCurrentCommitHash: vi.fn() }));
vi.mock("@/lib/git-utils", () => gitUtils);

const db = vi.hoisted(() => ({
  prisma: {
    codebaseManifest: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock("@dpf/db", () => db);

import { projectFilesPack } from "./project-files-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "list_project_directory",
  "read_project_file",
  "search_project_files",
  "generate_codebase_manifest",
  "read_codebase_manifest",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project-files pack — registration", () => {
  it("exposes exactly the five tools in both definitions and handlers", () => {
    expect(projectFilesPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(projectFilesPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of projectFilesPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: every tool gates on file_read", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(projectFilesPack.grants[t]).toEqual(["file_read"]);
      expect(isToolAllowedByGrants(t, ["file_read"])).toBe(true);
    }
  });
});

describe("project-files pack — handler behavior (delegation preserved)", () => {
  it("list_project_directory delegates and formats directory entries", async () => {
    codebaseTools.listProjectDirectory.mockResolvedValue({
      entries: [
        { type: "dir", path: "src" },
        { type: "file", path: "README.md" },
      ],
    });
    const res = await projectFilesPack.handlers.list_project_directory({ path: "." }, "u1", {});
    expect(res.success).toBe(true);
    expect(codebaseTools.listProjectDirectory).toHaveBeenCalledWith(".");
    expect(res.message).toContain("[dir] src");
  });

  it("read_project_file surfaces a service error without throwing", async () => {
    codebaseTools.readProjectFile.mockResolvedValue({ error: "path not allowed" });
    const res = await projectFilesPack.handlers.read_project_file({ path: ".env" }, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("path not allowed");
  });

  it("search_project_files auto-splits a combined query:glob argument", async () => {
    codebaseTools.searchProjectFiles.mockResolvedValue({
      results: [{ path: "a.prisma", line: 3, text: "voucher" }],
    });
    const res = await projectFilesPack.handlers.search_project_files(
      { query: "voucher:*.prisma" },
      "u1",
      {},
    );
    expect(res.success).toBe(true);
    expect(codebaseTools.searchProjectFiles).toHaveBeenCalledWith("voucher", { glob: "*.prisma" });
  });

  it("generate_codebase_manifest refuses off a non-dev instance", async () => {
    codebaseTools.isDevInstance.mockReturnValue(false);
    const res = await projectFilesPack.handlers.generate_codebase_manifest({}, "u1", {});
    expect(res.success).toBe(false);
    expect(manifestGenerator.generateManifest).not.toHaveBeenCalled();
  });

  it("read_codebase_manifest returns the DB manifest when present", async () => {
    db.prisma.codebaseManifest.findFirst.mockResolvedValue({
      version: "dev",
      gitRef: "abc123",
      manifest: { modules: [] },
      generatedAt: new Date("2026-07-12T00:00:00Z"),
    });
    const res = await projectFilesPack.handlers.read_codebase_manifest({ version: "dev" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ version: "dev", gitRef: "abc123" });
  });
});
