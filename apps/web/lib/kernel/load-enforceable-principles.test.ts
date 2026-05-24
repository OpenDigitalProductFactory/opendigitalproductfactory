import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { wikiPage: { findMany: vi.fn() } },
}));

import { loadEnforceablePrinciples, __resetCacheForTest } from "./load-enforceable-principles";
import { prisma } from "@dpf/db";

const findManyMock = prisma.wikiPage.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetCacheForTest();
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
  findManyMock.mockReset();
});

describe("loadEnforceablePrinciples — filter + shape", () => {
  it("returns only rows with non-empty runtime.patterns + valid tier + valid modes", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "a",
        slug: "with-runtime",
        principleTier: "commandment",
        principleRuntimeEnforcement: {
          interactiveMode: "confirm",
          autonomousMode: "refuse",
          patterns: [{ kind: "shell", regex: "^x", rationale: "x" }],
        },
      },
      {
        id: "b",
        slug: "empty-patterns",
        principleTier: "commandment",
        principleRuntimeEnforcement: { interactiveMode: "confirm", autonomousMode: "refuse", patterns: [] },
      },
      { id: "c", slug: "no-runtime", principleTier: "commandment", principleRuntimeEnforcement: null },
      {
        id: "d",
        slug: "invalid-mode",
        principleTier: "commandment",
        principleRuntimeEnforcement: {
          interactiveMode: "bogus",
          autonomousMode: "refuse",
          patterns: [{ kind: "shell", regex: "^x", rationale: "x" }],
        },
      },
      {
        id: "e",
        slug: "missing-tier",
        principleTier: null,
        principleRuntimeEnforcement: {
          interactiveMode: "confirm",
          autonomousMode: "refuse",
          patterns: [{ kind: "shell", regex: "^x", rationale: "x" }],
        },
      },
    ]);
    const out = await loadEnforceablePrinciples();
    expect(out.map((p) => p.slug)).toEqual(["with-runtime"]);
  });
});

describe("loadEnforceablePrinciples — caching", () => {
  it("caches the result across calls (one Postgres query per process)", async () => {
    findManyMock.mockResolvedValue([]);
    await loadEnforceablePrinciples();
    await loadEnforceablePrinciples();
    await loadEnforceablePrinciples();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("__resetCacheForTest forces a re-query", async () => {
    findManyMock.mockResolvedValue([]);
    await loadEnforceablePrinciples();
    __resetCacheForTest();
    await loadEnforceablePrinciples();
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });
});

describe("loadEnforceablePrinciples — defensive behavior", () => {
  it("returns [] + warns when prisma.wikiPage.findMany is unavailable (partial-mock tests)", async () => {
    // Simulate a test that mocked @dpf/db without stubbing wikiPage.
    const original = (prisma as { wikiPage?: unknown }).wikiPage;
    (prisma as { wikiPage?: unknown }).wikiPage = undefined;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await loadEnforceablePrinciples();
      expect(out).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[runtime-gate] prisma.wikiPage.findMany unavailable"),
      );
    } finally {
      (prisma as { wikiPage?: unknown }).wikiPage = original;
      warnSpy.mockRestore();
    }
  });

  it("returns [] + warns when findMany throws (pre-migration install)", async () => {
    findManyMock.mockRejectedValueOnce(new Error("column does not exist"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await loadEnforceablePrinciples();
      expect(out).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[runtime-gate] wikiPage query failed"),
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("loadEnforceablePrinciples — synthetic probe", () => {
  it("appends the synthetic probe principle only when DPF_TEST_MCP_REFUSE_PROBE=1", async () => {
    findManyMock.mockResolvedValue([]);
    process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
    const out = await loadEnforceablePrinciples();
    const probe = out.find((p) => p.slug === "__synthetic_refuse_probe__");
    expect(probe).toBeDefined();
    expect(probe?.runtime.patterns).toEqual([
      {
        kind: "mcp_tool",
        toolName: "dpf_test_kernel_refuse_probe",
        rationale: "synthetic probe (DPF_TEST_MCP_REFUSE_PROBE)",
      },
    ]);
  });

  it("does NOT inject the synthetic probe when the env is unset", async () => {
    findManyMock.mockResolvedValue([]);
    const out = await loadEnforceablePrinciples();
    expect(out.find((p) => p.slug === "__synthetic_refuse_probe__")).toBeUndefined();
  });

  it("synthetic probe is appended even when cache is warm (env check happens on every call)", async () => {
    findManyMock.mockResolvedValue([]);
    await loadEnforceablePrinciples();  // cold call, cache warmed
    process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
    const out = await loadEnforceablePrinciples();  // warm call but env now set
    expect(out.find((p) => p.slug === "__synthetic_refuse_probe__")).toBeDefined();
    // Confirm the cache was NOT re-queried
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
