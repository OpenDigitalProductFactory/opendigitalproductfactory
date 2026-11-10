// BI-6CFC5429: the schema reader must answer from the MERGE TARGET, not from
// whatever tree this process happens to sit in.
//
// Live evidence: PROJECT_ROOT is /sandbox-workspace, a Build Studio sandbox
// whose branch MOVES — observed on client/5727856b-… on 2026-08-26 and
// pr-4917-head on 2026-09-01. The same question got different answers on
// different days, and a model absent from today's sandbox branch read as absent
// from the platform.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
const readdir = vi.fn();
const readFile = vi.fn();

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyExec: () => execMock,
  lazyFsPromises: () => ({ readdir, readFile, rm: vi.fn() }),
  lazyPath: () => ({
    resolve: (...p: string[]) => p.join("/"),
    basename: (p: string) => p.split("/").filter(Boolean).pop() ?? "",
  }),
  lazyOs: () => ({ tmpdir: () => "/tmp" }),
  getCwd: () => "/cwd",
}));

import { loadCommittedSchema } from "./committed-schema-source";

const ok = (stdout: string) => ({ stdout, stderr: "" });
const SHA = "ce6c2774b60525a02fc74b7190af3fc4a50386d2";

beforeEach(() => {
  execMock.mockReset();
  readdir.mockReset();
  readFile.mockReset();
  process.env.PROJECT_ROOT = "/sandbox-workspace";
});

/** readGit is injected, so only resolveDefaultBranchRef goes through exec. */
function gitReaderFor(files: Record<string, string>) {
  return async (_root: string, args: string): Promise<string | null> => {
    if (args.startsWith("ls-tree")) return Object.keys(files).join("\n");
    const show = /^show [^:]+:(.+)$/.exec(args);
    if (show) return files[show[1]] ?? null;
    return null;
  };
}

describe("committed schema — reads the default branch", () => {
  it("answers from origin/main even though the working tree is on a sandbox branch", async () => {
    execMock.mockResolvedValueOnce(ok(`${SHA}\n`)); // rev-parse --verify origin/main

    const result = await loadCommittedSchema({
      readGit: gitReaderFor({
        "packages/db/prisma/schema/finance.prisma": "model MileageRate {}",
        "packages/db/prisma/schema/workforce.prisma": "model PayRun {}",
      }),
    });

    expect(result!.provenance.branch).toBe("main");
    expect(result!.provenance.headSha).toBe(SHA);
    expect(result!.provenance.identified).toBe(true);
    expect(result!.provenance.schemaFileCount).toBe(2);
    expect(result!.schema).toContain("model MileageRate");
    // The working tree was never touched.
    expect(readdir).not.toHaveBeenCalled();
  });

  it("scores the default branch at full freshness and high trust", async () => {
    execMock.mockResolvedValueOnce(ok(`${SHA}\n`));
    const result = await loadCommittedSchema({
      readGit: gitReaderFor({ "packages/db/prisma/schema/a.prisma": "model A {}" }),
    });
    const freshness = result!.trust.dimensions.find((d) => d.key === "freshness");
    expect(freshness!.score).toBe(1);
    expect(result!.trust.tier).toBe("high");
  });

  // A ref we cannot fully read is NOT a partial schema — returning some of it
  // would silently under-report models, which is the defect class this reader
  // exists to prevent.
  it("falls back to the working tree when a blob in the ref is unreadable", async () => {
    execMock.mockResolvedValueOnce(ok(`${SHA}\n`));
    readdir.mockResolvedValueOnce(["local.prisma"]);
    readFile.mockResolvedValueOnce("model FromWorkingTree {}");

    const result = await loadCommittedSchema({
      readGit: async (_root, args) => {
        if (args.startsWith("ls-tree")) return "packages/db/prisma/schema/a.prisma";
        if (args.startsWith("show")) return null; // blob unreadable
        return "pr-4917-head";
      },
      readBranchFallback: async () => "pr-4917-head",
    });

    expect(result!.schema).toContain("FromWorkingTree");
    expect(result!.provenance.branch).toBe("pr-4917-head");
    // and it is capped and named, not presented as authoritative
    expect(result!.trust.dimensions.find((d) => d.key === "freshness")!.score).toBeLessThanOrEqual(0.4);
  });

  it("falls back to the working tree when no default branch resolves", async () => {
    execMock.mockResolvedValue(ok("")); // no candidate ref resolves
    readdir.mockResolvedValueOnce(["local.prisma"]);
    readFile.mockResolvedValueOnce("model FromWorkingTree {}");

    const result = await loadCommittedSchema({
      readGit: async () => null,
      readBranchFallback: async () => "client/5727856b",
    });

    expect(result!.schema).toContain("FromWorkingTree");
    expect(result!.provenance.branch).toBe("client/5727856b");
  });
});

// The default git reader is the ONLY path production takes — every other test
// here injects readGit, which is exactly why the missing safe.directory flag
// shipped in #4951 and degraded every live call in silence.
describe("default git reader", () => {
  it("carries a scoped safe.directory so container ownership cannot block the read", async () => {
    const { buildCommittedSchemaGitCommand } = await import("./committed-schema-source");
    const cmd = buildCommittedSchemaGitCommand("/sandbox-workspace", "ls-tree --name-only origin/main");
    expect(cmd).toContain('-c safe.directory="/sandbox-workspace"');
    expect(cmd).toContain("ls-tree --name-only origin/main");
    // The flag must precede the subcommand, or git rejects it.
    expect(cmd.indexOf("safe.directory")).toBeLessThan(cmd.indexOf("ls-tree"));
  });
});
