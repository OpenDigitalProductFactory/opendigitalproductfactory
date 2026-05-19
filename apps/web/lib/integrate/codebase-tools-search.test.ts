import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

vi.mock("@/lib/shared/lazy-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shared/lazy-node")>();
  return {
    ...actual,
    lazyExec: () => mockExecAsync,
  };
});

import { searchProjectFiles } from "./codebase-tools";

describe("searchProjectFiles", () => {
  let projectRoot: string;
  let originalProjectRoot: string | undefined;

  beforeEach(() => {
    originalProjectRoot = process.env.PROJECT_ROOT;
    projectRoot = mkdtempSync(join(tmpdir(), "dpf-codebase-search-"));
    mkdirSync(join(projectRoot, "packages/db/src"), { recursive: true });
    writeFileSync(
      join(projectRoot, "packages/db/src/seed-geographic-data.ts"),
      [
        "export async function seedCityOnce() {",
        "  return 'P2002 tolerated';",
        "}",
      ].join("\n"),
    );
    process.env.PROJECT_ROOT = projectRoot;
    mockExecAsync.mockImplementation(async () => {
      throw new Error("fatal: not a git repository");
    });
  });

  afterEach(() => {
    if (originalProjectRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = originalProjectRoot;
    rmSync(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("falls back to filesystem search when git grep is unavailable", async () => {
    const result = await searchProjectFiles("seedCityOnce", {
      glob: "*.ts",
      maxResults: 5,
    });

    expect(result).toEqual({
      results: [
        {
          path: "packages/db/src/seed-geographic-data.ts",
          line: 1,
          text: "export async function seedCityOnce() {",
        },
      ],
    });
  });

  it("filters package-store matches from git grep output", async () => {
    mockExecAsync.mockResolvedValue({
      stdout: [
        ".pnpm-store/v10/index/noise.json:1:seedCityOnce",
        "packages/db/generated/client/index.d.ts:1:seedCityOnce",
        "packages/db/src/seed-geographic-data.ts:1:export async function seedCityOnce() {",
      ].join("\n"),
      stderr: "",
    });

    const result = await searchProjectFiles("seedCityOnce", {
      glob: "*.ts",
      maxResults: 5,
    });

    expect(result).toEqual({
      results: [
        {
          path: "packages/db/src/seed-geographic-data.ts",
          line: 1,
          text: "export async function seedCityOnce() {",
        },
      ],
    });
  });

  it("parses CRLF git grep output from Windows-authored source files", async () => {
    mockExecAsync.mockResolvedValue({
      stdout: [
        "HEAD:packages/db/src/seed-geographic-data.ts:223:export async function seedGeographicData(prisma: PrismaClient): Promise<void> {\r",
        "HEAD:packages/db/src/seed.ts:16:import { seedGeographicData } from \"./seed-geographic-data.js\";\r",
      ].join("\n"),
      stderr: "",
    });

    const result = await searchProjectFiles("seedGeographicData", {
      glob: "*.ts",
      maxResults: 5,
    });

    expect(result).toEqual({
      results: [
        {
          path: "packages/db/src/seed-geographic-data.ts",
          line: 223,
          text: "export async function seedGeographicData(prisma: PrismaClient): Promise<void> {",
        },
        {
          path: "packages/db/src/seed.ts",
          line: 16,
          text: "import { seedGeographicData } from \"./seed-geographic-data.js\";",
        },
      ],
    });
  });
});
