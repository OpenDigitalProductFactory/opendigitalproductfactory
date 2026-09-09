import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setGovernedToolAuditOverridesForTests,
  writeGovernedToolAudit,
} from "./governed-tool-audit";
import type { ToolDefinition } from "./mcp-tools";

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
      result: {},
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
