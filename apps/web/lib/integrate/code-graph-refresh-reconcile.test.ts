import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExec, mockReadFile, mockRunCypher } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockReadFile: vi.fn(),
  mockRunCypher: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    codeGraphIndexState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    codeGraphFileHash: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
  runCypher: mockRunCypher,
}));

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyExec: () => mockExec,
  lazyFsPromises: () => ({
    readFile: mockReadFile,
  }),
  lazyPath: () => ({
    resolve: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
    relative: (from: string, to: string) => to.replace(`${from}/`, ""),
    extname: (value: string) => {
      const idx = value.lastIndexOf(".");
      return idx === -1 ? "" : value.slice(idx);
    },
  }),
  lazyCrypto: () => ({
    createHash: () => {
      let content = "";
      return {
        update(chunk: string) {
          content += chunk;
          return this;
        },
        digest() {
          return `sha256:${content.length}`;
        },
      };
    },
  }),
}));

import { prisma } from "@dpf/db";
import {
  buildListTrackedFilesCommand,
  CODE_GRAPH_GRAPH_KEY,
  reconcileCodeGraph,
} from "./code-graph-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROJECT_ROOT = "/workspace";
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ locked: true }] as never);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
  vi.mocked(prisma.codeGraphFileHash.count).mockResolvedValue(1);
  vi.mocked(prisma.codeGraphFileHash.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.codeGraphFileHash.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.codeGraphIndexState.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.codeGraphIndexState.update).mockResolvedValue({} as never);
});

describe("reconcileCodeGraph", () => {
  it("excludes tracked cache directories when listing code files", () => {
    const command = buildListTrackedFilesCommand();
    expect(command).toContain(".pnpm-store");
    expect(command).toContain(".next");
    expect(command).toContain("node_modules");
    expect(command).toContain("*.ts");
  });

  it("performs a full rebuild when no prior index exists", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(null);

    mockExec.mockImplementation(async (command: string) => {
      if (command === "git rev-parse HEAD") return { stdout: "head-1\n", stderr: "" };
      if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (command === "git status --porcelain") return { stdout: "", stderr: "" };
      if (command.startsWith("git ls-files -- ")) {
        return {
          stdout: "apps/web/lib/integrate/change-impact.ts\npackages/db/prisma/schema.prisma\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("change-impact.ts")) return "export const impact = true;";
      if (filePath.endsWith("schema.prisma")) return "model Example { id String @id }";
      throw new Error(`Unexpected file read: ${filePath}`);
    });

    const result = await reconcileCodeGraph({ reason: "scheduled" });

    expect(result.mode).toBe("full");
    expect(result.headSha).toBe("head-1");
    expect(result.workspaceDirty).toBe(false);
    expect(mockRunCypher).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (n:CodeFile"),
      expect.objectContaining({ graphKey: CODE_GRAPH_GRAPH_KEY }),
    );
    expect(prisma.codeGraphIndexState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { graphKey: CODE_GRAPH_GRAPH_KEY },
      }),
    );
  });

  it("performs an incremental reconcile when HEAD changes", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: CODE_GRAPH_GRAPH_KEY,
      lastIndexedHeadSha: "head-1",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (command === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (command === "git status --porcelain") return { stdout: "", stderr: "" };
      if (command === "git diff --name-only head-1..head-2") {
        return {
          stdout: "apps/web/lib/integrate/change-impact.ts\napps/web/lib/integrate/removed.ts\n",
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("change-impact.ts")) return "export const impact = 2;";
      throw new Error(`ENOENT: ${filePath}`);
    });

    const result = await reconcileCodeGraph({ reason: "git-commit" });

    expect(result.mode).toBe("incremental");
    expect(result.changedFiles).toEqual([
      "apps/web/lib/integrate/change-impact.ts",
      "apps/web/lib/integrate/removed.ts",
    ]);
    expect(prisma.codeGraphFileHash.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          graphKey: CODE_GRAPH_GRAPH_KEY,
          filePath: "apps/web/lib/integrate/removed.ts",
        },
      }),
    );
  });

  it("returns noop when the indexed head already matches HEAD and marks dirty worktrees", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: CODE_GRAPH_GRAPH_KEY,
      lastIndexedHeadSha: "head-2",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (command === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (command === "git status --porcelain") return { stdout: " M apps/web/lib/foo.ts\n", stderr: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await reconcileCodeGraph({ reason: "scheduled" });

    expect(result.mode).toBe("noop");
    expect(result.workspaceDirty).toBe(true);
    expect(prisma.codeGraphIndexState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          workspaceDirty: true,
        }),
      }),
    );
  });
});
