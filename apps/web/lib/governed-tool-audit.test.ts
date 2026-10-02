import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setGovernedToolAuditOverridesForTests,
  writeGovernedToolAudit,
} from "./governed-tool-audit";
import type { ToolDefinition } from "./mcp-tool-types";

const baseTool: ToolDefinition = {
  name: "read_source_at_version",
  description: "Read immutable source",
  inputSchema: {
    type: "object",
    properties: {
      repositoryFullName: { type: "string" },
      path: { type: "string" },
      version: { type: "string" },
      expectedBlobId: { type: "string" },
      token: { type: "string", writeOnly: true },
    },
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: false,
};

afterEach(() => setGovernedToolAuditOverridesForTests({}));

describe("writeGovernedToolAudit", () => {
  it("retains redacted parameters for an opted-in metrics-only tool while suppressing its result", async () => {
    const create = vi.fn(async () => ({ id: "tool-execution-1" }));
    setGovernedToolAuditOverridesForTests({ create });

    await writeGovernedToolAudit({
      toolName: baseTool.name,
      tool: { ...baseTool, retainAuditParameters: true },
      rawParams: {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        path: "docs/spec.md",
        version: "a".repeat(40),
        expectedBlobId: "b".repeat(40),
        token: "secret",
      },
      result: { success: true, message: "read", data: { content: "source bytes must not be journaled" } },
      userId: "user-1",
      source: "agentic-loop",
      context: { agentId: "portfolio-advisor", taskRunId: "TR-1" },
      durationMs: 12,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      auditClass: "metrics_only",
      parameters: {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        path: "docs/spec.md",
        version: "a".repeat(40),
        expectedBlobId: "b".repeat(40),
        token: "[REDACTED]",
      },
      result: {},
    }));
  });

  it("keeps ordinary metrics-only tool parameters empty", async () => {
    const create = vi.fn(async () => ({ id: "tool-execution-2" }));
    setGovernedToolAuditOverridesForTests({ create });

    await writeGovernedToolAudit({
      toolName: baseTool.name,
      tool: baseTool,
      rawParams: { path: "docs/spec.md" },
      result: { success: false, error: "missing", message: "missing" },
      userId: "user-1",
      source: "agentic-loop",
      durationMs: 4,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      auditClass: "metrics_only",
      parameters: {},
      result: { error: "missing" },
    }));
  });
});

describe("writeGovernedToolAudit — payload ceiling (BI-39AAE9B8)", () => {
  it("replaces an oversized ledger parameter with a digest marker and keeps the rest verbatim", async () => {
    const create = vi.fn(async () => ({ id: "tool-execution-2" }));
    setGovernedToolAuditOverridesForTests({ create });
    const log = "L".repeat(200 * 1024);

    await writeGovernedToolAudit({
      // Audit class is derived from the PLATFORM registry by tool name, so use
      // a real ledger tool: the one that actually carried multi-megabyte logs.
      toolName: "record_local_integration_result",
      rawParams: { candidateBranch: "feat/x", evidence: { output: log, sha: "abc" } },
      result: { success: true, message: "recorded" },
      userId: "user-1",
      source: "external-jsonrpc",
      durationMs: 5,
    });

    const row = (create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0] as unknown as { auditClass: string; parameters: { candidateBranch: string; evidence: { sha: string; output: unknown } } };
    expect(row.auditClass).toBe("ledger");
    expect(row.parameters.candidateBranch).toBe("feat/x");
    expect(row.parameters.evidence.sha).toBe("abc");
    expect(row.parameters.evidence.output).toMatchObject({ __dpfBounded: true, byteLength: 200 * 1024 });
    expect(JSON.stringify(row.parameters).length).toBeLessThan(8 * 1024);
  });
});

describe("writeGovernedToolAudit — the summary is an identity, not a timing trace", () => {
  async function summaryFor(durationMs: number): Promise<string | null> {
    const create = vi.fn(async () => ({ id: "tool-execution-3" }));
    setGovernedToolAuditOverridesForTests({ create });

    await writeGovernedToolAudit({
      toolName: "query_backlog",
      rawParams: { title: "x" },
      result: { success: true, message: "ok" },
      userId: "user-1",
      source: "rest",
      durationMs,
    });

    const row = (create.mock.calls as unknown as Array<[{ summary: string | null; durationMs: number }]>)[0]![0];
    expect(row.durationMs).toBe(durationMs);
    return row.summary;
  }

  // AC-ENFORCE deep-equals two consecutive runs of the same call. Any wall-clock
  // in `summary` makes that assertion a coin flip under a loaded host — 0ms
  // rendered nothing, 1ms rendered " (1ms)". The duration belongs to its own
  // numeric column, so identical calls must produce byte-identical summaries.
  it("renders the same summary regardless of how long the call took", async () => {
    // Sequential: each case installs its own create override on shared state.
    const summaries: Array<string | null> = [];
    for (const ms of [0, 1, 7, 1234]) summaries.push(await summaryFor(ms));

    expect(new Set(summaries).size).toBe(1);
    expect(summaries[0]).toBe("query_backlog: ok");
  });

  it("never renders a duration fragment into the summary", async () => {
    expect(await summaryFor(42)).not.toMatch(/\d+\s*ms/);
  });
});
