import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above const declarations, so the fn must be hoisted too.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyExec: () => execMock,
  lazyPath: () => ({ resolve: (...p: string[]) => p.join("/") }),
  getCwd: () => "/cwd",
}));

import { inspectGitRoot, normalizeGitOutput } from "./git-snapshot";

beforeEach(() => execMock.mockReset());

describe("normalizeGitOutput", () => {
  it("trims blank lines and preserves file paths", () => {
    expect(normalizeGitOutput("\n apps/web/lib/a.ts \n\npackages/db/schema.prisma\n")).toEqual([
      "apps/web/lib/a.ts",
      "packages/db/schema.prisma",
    ]);
  });
});

// BI-86EF5900: git REFUSING a repository is not the same as there being none.
// The portal container runs as a different uid than the checkout it mounts, so
// every git call there died with "detected dubious ownership" — which the old
// boolean collapsed into "no repo", making the indexer no-op silently forever.
describe("inspectGitRoot — refused vs absent", () => {
  it("classifies dubious ownership as REFUSED, not absent", async () => {
    execMock.mockRejectedValueOnce(
      new Error("fatal: detected dubious ownership in repository at '/sandbox-workspace'"),
    );
    const status = await inspectGitRoot("/sandbox-workspace");
    expect(status.kind).toBe("refused");
  });

  it("classifies a genuinely missing repository as ABSENT", async () => {
    execMock.mockRejectedValueOnce(new Error("fatal: not a git repository (or any of the parent directories)"));
    expect((await inspectGitRoot("/app")).kind).toBe("absent");
  });

  it("passes a scoped safe.directory exception so ownership cannot block the read", async () => {
    execMock.mockResolvedValueOnce({ stdout: "true\n", stderr: "" });
    await inspectGitRoot("/sandbox-workspace");
    expect(String(execMock.mock.calls[0]?.[0])).toContain('-c safe.directory="/sandbox-workspace"');
  });

  it("reports a readable work tree", async () => {
    execMock.mockResolvedValueOnce({ stdout: "true\n", stderr: "" });
    expect((await inspectGitRoot("/repo")).kind).toBe("work-tree");
  });
});
