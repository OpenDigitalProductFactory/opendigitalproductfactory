import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExec, mockReadFile, mockExecRawUnsafe } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockReadFile: vi.fn(),
  // BET-5: the structural projection now UPSERTs into the Postgres graph mirror
  // via prisma.$executeRawUnsafe (INSERT INTO graph_node / graph_edge, one call
  // per node/edge fact) instead of batching Cypher MERGE via runCypher.
  mockExecRawUnsafe: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: mockExecRawUnsafe,
    codeGraphIndexState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    codeGraphFileHash: {
      upsert: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

/** graph_node upserts call $executeRawUnsafe(sql, key, labels, propsJson). */
function nodeUpsertCalls(labelFilter?: string) {
  return mockExecRawUnsafe.mock.calls
    .filter(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO graph_node"))
    .map((call) => ({
      key: call[1] as string,
      labels: call[2] as string[],
      props: JSON.parse(call[3] as string) as Record<string, unknown>,
    }))
    .filter((n) => (labelFilter ? n.labels.includes(labelFilter) : true));
}

/** graph_edge upserts call $executeRawUnsafe(sql, src, dst, relType, propsJson). */
function edgeUpsertCalls(relTypeFilter?: string) {
  return mockExecRawUnsafe.mock.calls
    .filter(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO graph_edge"))
    .map((call) => ({
      src: call[1] as string,
      dst: call[2] as string,
      relType: call[3] as string,
      props: JSON.parse((call[4] ?? "{}") as string) as Record<string, unknown>,
    }))
    .filter((e) => (relTypeFilter ? e.relType === relTypeFilter : true));
}

/** SQL text of every $executeRawUnsafe statement (for negative structural checks). */
function execStatements() {
  return mockExecRawUnsafe.mock.calls.map(([sql]) => String(sql));
}

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

// Git calls now carry a scoped `-c safe.directory=<root>` exception
// (BI-86EF5900: the portal container runs as a different uid than the checkout,
// so an unprefixed git refuses outright). These fixtures assert on the git
// SUBCOMMAND, not on the exact invocation, so the transport-level flag does not
// have to be restated in every mock.
const gitSub = (command: unknown): string =>
  typeof command === "string"
    ? command.replace(/ -c safe\.directory=(?:"[^"]*"|\S+)/g, "")
    : String(command);

import {
  buildListTrackedFilesCommand,
  CODE_GRAPH_GRAPH_KEY,
  CODE_GRAPH_PROJECTION_VERSION,
  reconcileCodeGraph,
} from "./code-graph-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROJECT_ROOT = "/workspace";
  mockExecRawUnsafe.mockResolvedValue(undefined);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ locked: true }] as never);
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
  vi.mocked(prisma.codeGraphFileHash.count).mockResolvedValue(1);
  vi.mocked(prisma.codeGraphFileHash.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.codeGraphFileHash.createMany).mockResolvedValue({ count: 1 } as never);
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
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-1\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: "", stderr: "" };
      if (gitSub(command).startsWith("git ls-files -- ")) {
        return {
          stdout: "apps/web/lib/integrate/change-impact.ts\npackages/db/prisma/schema.prisma\n",
          stderr: "",
        };
      }
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
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
    // A full rebuild clears the whole graphKey up front (clearCodeGraph), then
    // re-projects. The clear deletes graph_node rows scoped by props->>'graphKey'.
    expect(mockExecRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM graph_node WHERE props->>'graphKey' = $1"),
      CODE_GRAPH_GRAPH_KEY,
    );
    // A full rebuild must NOT emit the per-file incremental structural clears
    // (those are scoped by props->>'filePath' / props->>'path').
    const statements = execStatements();
    expect(statements.some((s) => s.includes("props->>'filePath'"))).toBe(false);
    expect(statements.some((s) => s.includes("props->>'path'"))).toBe(false);
    expect(prisma.codeGraphFileHash.deleteMany).toHaveBeenCalledWith({
      where: { graphKey: CODE_GRAPH_GRAPH_KEY },
    });
    expect(prisma.codeGraphIndexState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { graphKey: CODE_GRAPH_GRAPH_KEY },
      }),
    );
  });

  it("projects CodeSymbol nodes and DEFINES edges from extracted facts", async () => {
    // Intent preserved from the Neo4j era (which batched via UNWIND): every
    // extracted symbol becomes a CodeSymbol node and each symbol its file
    // defines becomes a DEFINES edge. The Postgres mirror UPSERTs one row per
    // fact rather than one batched statement per label, so we assert on the
    // set of per-fact graph_node / graph_edge writes instead of batch shape.
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(null);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-1\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: "", stderr: "" };
      if (gitSub(command).startsWith("git ls-files -- ")) {
        return {
          stdout: "apps/web/lib/integrate/multi-symbol.ts\n",
          stderr: "",
        };
      }
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    mockReadFile.mockResolvedValue([
      "export function firstSymbol() { return true; }",
      "export function secondSymbol() { return false; }",
    ].join("\n"));

    await reconcileCodeGraph({ reason: "scheduled" });

    const symbolNodes = nodeUpsertCalls("CodeSymbol");
    const symbolNames = symbolNodes.map((n) => n.props.name);
    expect(symbolNames).toEqual(expect.arrayContaining(["firstSymbol", "secondSymbol"]));

    const definesEdges = edgeUpsertCalls("DEFINES");
    expect(definesEdges.length).toBeGreaterThan(0);
    // The DEFINES edge runs CodeFile(src) → CodeSymbol(dst) with exact confidence.
    expect(definesEdges.some((e) => e.props.confidence === "exact")).toBe(true);
    expect(definesEdges[0]?.props).toEqual(
      expect.objectContaining({ fromKey: definesEdges[0]?.src, toKey: definesEdges[0]?.dst }),
    );
  });

  it("projects every CodeFile node during full rebuilds", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue(null);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-1\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: "", stderr: "" };
      if (gitSub(command).startsWith("git ls-files -- ")) {
        return {
          stdout: "apps/web/lib/one.ts\napps/web/lib/two.ts\n",
          stderr: "",
        };
      }
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    mockReadFile.mockResolvedValue("export function example() { return true; }");

    await reconcileCodeGraph({ reason: "scheduled" });

    // Both tracked files are projected as CodeFile graph_node rows (one UPSERT
    // per file; the CodeFile props carry the source path).
    const codeFileNodes = nodeUpsertCalls("CodeFile");
    const codeFilePaths = codeFileNodes.map((n) => n.props.path);
    expect(codeFilePaths).toEqual(
      expect.arrayContaining(["apps/web/lib/one.ts", "apps/web/lib/two.ts"]),
    );
    expect(prisma.codeGraphFileHash.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ filePath: "apps/web/lib/one.ts" }),
        expect.objectContaining({ filePath: "apps/web/lib/two.ts" }),
      ]),
    }));
    expect(prisma.codeGraphFileHash.upsert).not.toHaveBeenCalled();
  });

  it("performs an incremental reconcile when HEAD changes", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: CODE_GRAPH_GRAPH_KEY,
      graphVersion: CODE_GRAPH_PROJECTION_VERSION,
      lastIndexedHeadSha: "head-1",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: "", stderr: "" };
      if (gitSub(command) === "git diff --name-only head-1..head-2") {
        return {
          stdout: "apps/web/lib/integrate/change-impact.ts\napps/web/lib/integrate/removed.ts\n",
          stderr: "",
        };
      }
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
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
      graphVersion: CODE_GRAPH_PROJECTION_VERSION,
      lastIndexedHeadSha: "head-2",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: " M apps/web/lib/foo.ts\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
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

  it("keeps the graph ready when dirty-state detection times out", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: CODE_GRAPH_GRAPH_KEY,
      graphVersion: CODE_GRAPH_PROJECTION_VERSION,
      lastIndexedHeadSha: "head-2",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") {
        throw new Error("Command failed: git status --porcelain");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await reconcileCodeGraph({ reason: "scheduled" });

    expect(result.mode).toBe("noop");
    expect(result.workspaceDirty).toBe(true);
    expect(prisma.codeGraphIndexState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          indexStatus: "ready",
          lastError: null,
          workspaceDirty: true,
        }),
      }),
    );
  });

  it("performs a full rebuild when the stored graph projection version is stale", async () => {
    vi.mocked(prisma.codeGraphIndexState.findUnique).mockResolvedValue({
      graphKey: CODE_GRAPH_GRAPH_KEY,
      graphVersion: 1,
      lastIndexedHeadSha: "head-2",
    } as never);

    mockExec.mockImplementation(async (command: string) => {
      if (gitSub(command) === "git rev-parse HEAD") return { stdout: "head-2\n", stderr: "" };
      if (gitSub(command) === "git rev-parse --abbrev-ref HEAD") return { stdout: "main\n", stderr: "" };
      if (gitSub(command) === "git status --porcelain") return { stdout: "", stderr: "" };
      if (gitSub(command).startsWith("git ls-files -- ")) {
        return {
          stdout: "apps/web/lib/integrate/code-graph/graph-queries.ts\n",
          stderr: "",
        };
      }
      if (gitSub(command) === "git rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    mockReadFile.mockResolvedValue("export const searchCodeGraph = true;");

    const result = await reconcileCodeGraph({ reason: "scheduled" });

    expect(result.mode).toBe("full");
    expect(result.changedFiles).toEqual(["apps/web/lib/integrate/code-graph/graph-queries.ts"]);
    expect(mockExec).not.toHaveBeenCalledWith("git diff --name-only head-2..head-2", expect.anything());
  });
});
