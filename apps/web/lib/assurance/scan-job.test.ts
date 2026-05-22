import { describe, expect, it, vi } from "vitest";
import { runBuildAssuranceScan } from "./scan-job";

const SAMPLE_AUDIT_JSON = JSON.stringify({
  advisories: {
    "GHSA-1111": {
      id: 1111,
      ghsa_id: "GHSA-1111",
      severity: "critical",
      title: "Critical issue in alpha",
      module_name: "alpha",
      patched_versions: ">=1.0.1",
      findings: [{ version: "1.0.0", paths: ["apps/web>alpha"] }],
    },
  },
});

function createDb(overrides: Record<string, unknown> = {}) {
  return {
    featureBuild: {
      findUnique: vi.fn(async () => ({
        buildId: "BUILD-1",
        title: "Test build",
        threadId: null,
        digitalProductId: "product-1",
      })),
    },
    bomDocument: {
      findFirst: vi.fn(async () => ({
        id: "bom-db-1",
        documentId: "bom-doc-1",
        occurrences: [
          {
            component: {
              id: "component-db-1",
              componentKey: "component-key-alpha",
              name: "alpha",
              version: "1.0.0",
              packageUrl: "pkg:npm/alpha@1.0.0",
            },
          },
        ],
      })),
    },
    toolExecution: {
      create: vi.fn(async () => ({ id: "tool-exec-1" })),
    },
    toolExecutionReceipt: {
      create: vi.fn(async () => ({ id: "receipt-1" })),
    },
    assuranceRun: {
      create: vi.fn(async () => ({ id: "run-db-1", runId: "run-1" })),
    },
    assuranceFinding: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "af-1" })),
      update: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
    ...overrides,
  };
}

describe("runBuildAssuranceScan", () => {
  it("returns skipped when the build does not exist", async () => {
    const db = createDb({ featureBuild: { findUnique: vi.fn(async () => null) } });

    await expect(runBuildAssuranceScan({
      db: db as never,
      buildId: "missing",
      requestedByUserId: "user-1",
      projectRoot: "/app",
      now: new Date("2026-05-22T00:00:00.000Z"),
      runAudit: vi.fn(),
    })).resolves.toEqual({ skipped: true, reason: "build not found" });
  });

  it("returns skipped when no BOM exists for the build yet", async () => {
    const db = createDb({ bomDocument: { findFirst: vi.fn(async () => null) } });

    await expect(runBuildAssuranceScan({
      db: db as never,
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
      projectRoot: "/app",
      now: new Date("2026-05-22T00:00:00.000Z"),
      runAudit: vi.fn(),
    })).resolves.toEqual({ skipped: true, reason: "bom-not-generated" });
  });

  it("persists tool execution, receipt, assurance run, and findings on a successful audit", async () => {
    const db = createDb();
    const runAudit = vi.fn(async () => ({ stdout: SAMPLE_AUDIT_JSON, exitCode: 1 }));

    const result = await runBuildAssuranceScan({
      db: db as never,
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
      projectRoot: "/app",
      now: new Date("2026-05-22T00:00:00.000Z"),
      runAudit,
    });

    expect(result).toEqual(expect.objectContaining({
      skipped: false,
      runId: "run-1",
      blockingCount: 1,
      findingCount: 1,
      created: 1,
      updated: 0,
      reopened: 0,
    }));

    expect(db.assuranceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: expect.stringContaining("assurance_scan_BUILD-1"),
      }),
    });

    expect(db.toolExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toolName: "run_pnpm_audit",
        agentId: "system:assurance-ledger",
      }),
    });
    expect(db.toolExecutionReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptKind: "assurance-scan",
        executionStatus: "needs-review",
      }),
    });
    expect(db.assuranceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adapterKey: "pnpm-audit",
        status: "failed",
      }),
    });
    expect(db.assuranceFinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findingKind: "vulnerability",
        adapterKey: "pnpm-audit",
        bomComponentId: "component-db-1",
      }),
    });
    expect(db.buildActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tool: "assurance-scan",
        buildId: "BUILD-1",
      }),
    });
  });

  it("returns skipped with a categorised reason when pnpm audit exits with an unexpected code", async () => {
    const db = createDb();
    const runAudit = vi.fn(async () => ({ stdout: "", exitCode: 127 }));

    await expect(runBuildAssuranceScan({
      db: db as never,
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
      projectRoot: "/app",
      now: new Date("2026-05-22T00:00:00.000Z"),
      runAudit,
    })).resolves.toEqual({ skipped: true, reason: "pnpm-audit-exit-127" });

    expect(db.toolExecution.create).not.toHaveBeenCalled();
  });
});
