import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: {
      findFirst: vi.fn(),
    },
  },
}));

const runWikiLint = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  QDRANT_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
}));

vi.mock("@/lib/wiki/lint", () => ({
  runWikiLint: (...args: unknown[]) => runWikiLint(...args),
}));

import { executeTool } from "@/lib/mcp-tools";

afterEach(() => {
  mockPrisma.organization.findFirst.mockReset();
  runWikiLint.mockReset();
});

describe("wiki_lint MCP tool", () => {
  function lintRow(overrides: Partial<{
    organizationId: string | null;
    scannedPageCount: number;
    findingsOpened: number;
    findingsKept: number;
    findingsResolved: number;
  }> = {}) {
    return {
      organizationId: null,
      scannedPageCount: 0,
      findingsOpened: 0,
      findingsKept: 0,
      findingsResolved: 0,
      ...overrides,
    };
  }

  it("default scope 'all' lints kernel then current org", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_acme" });
    runWikiLint.mockResolvedValueOnce(lintRow({ scannedPageCount: 3, findingsOpened: 1 }));
    runWikiLint.mockResolvedValueOnce(lintRow({ organizationId: "org_acme", scannedPageCount: 5 }));

    const res = await executeTool("wiki_lint", {}, "user_test");

    expect(res.success).toBe(true);
    expect(runWikiLint).toHaveBeenCalledTimes(2);
    expect(runWikiLint.mock.calls[0][0]).toMatchObject({ organizationId: null });
    expect(runWikiLint.mock.calls[1][0]).toMatchObject({ organizationId: "org_acme" });
  });

  it("scope=kernel skips the org pass even when org exists", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_acme" });
    runWikiLint.mockResolvedValueOnce(lintRow());

    await executeTool("wiki_lint", { scope: "kernel" }, "user_test");

    expect(runWikiLint).toHaveBeenCalledTimes(1);
    expect(runWikiLint.mock.calls[0][0]).toMatchObject({ organizationId: null });
  });

  it("scope=org skips the kernel pass and uses the org id", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_acme" });
    runWikiLint.mockResolvedValueOnce(lintRow({ organizationId: "org_acme" }));

    await executeTool("wiki_lint", { scope: "org" }, "user_test");

    expect(runWikiLint).toHaveBeenCalledTimes(1);
    expect(runWikiLint.mock.calls[0][0]).toMatchObject({ organizationId: "org_acme" });
  });

  it("scope=org with no organisation row reports no work done", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce(null);

    const res = await executeTool("wiki_lint", { scope: "org" }, "user_test");

    expect(res.success).toBe(true);
    expect(res.message).toContain("No scope linted");
    expect(runWikiLint).not.toHaveBeenCalled();
  });

  it("formats one summary line per run with scope tag and finding deltas", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_acme" });
    runWikiLint.mockResolvedValueOnce(
      lintRow({ scannedPageCount: 12, findingsOpened: 2, findingsKept: 3, findingsResolved: 1 }),
    );
    runWikiLint.mockResolvedValueOnce(
      lintRow({ organizationId: "org_acme", scannedPageCount: 4, findingsOpened: 0, findingsKept: 1, findingsResolved: 5 }),
    );

    const res = await executeTool("wiki_lint", {}, "user_test");

    const lines = (res.message ?? "").split("\n");
    expect(lines[0]).toBe("kernel: scanned=12 opened=2 kept=3 resolved=1");
    expect(lines[1]).toBe("org org_acme: scanned=4 opened=0 kept=1 resolved=5");
  });
});
