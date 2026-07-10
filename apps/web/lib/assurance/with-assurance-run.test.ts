import { describe, expect, it, vi } from "vitest";
import { assuranceRunId, createAssuranceRun } from "./with-assurance-run";

describe("assuranceRunId", () => {
  it("joins prefix + sanitized buildId + sanitized toolExecutionId", () => {
    expect(assuranceRunId("assurance_scan_", "BUILD-1", "tool-1")).toBe("assurance_scan_BUILD-1_tool-1");
    expect(assuranceRunId("assurance_bom_", "BUILD-1", "tool-1")).toBe("assurance_bom_BUILD-1_tool-1");
  });

  it("replaces disallowed characters with underscores", () => {
    expect(assuranceRunId("p_", "a/b c.d", "x:y")).toBe("p_a_b_c_d_x_y");
  });

  it("caps each id part at 64 characters", () => {
    const long = "z".repeat(100);
    const runId = assuranceRunId("p_", long, long);
    // prefix + 64 chars + "_" + 64 chars
    expect(runId).toBe(`p_${"z".repeat(64)}_${"z".repeat(64)}`);
  });
});

describe("createAssuranceRun", () => {
  it("passes the fixed contract + varying fields through to assuranceRun.create", async () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const created = { id: "run-db-1", runId: "assurance_scan_BUILD-1_tool-1" };
    const create = vi.fn(async () => created);
    const db = { assuranceRun: { create } };

    const summary = { blockingCount: 2 };
    const result = await createAssuranceRun(db, {
      prefix: "assurance_scan_",
      buildId: "BUILD-1",
      digitalProductId: "product-1",
      adapterKey: "pnpm-audit",
      adapterVersion: "1.2.3",
      status: "failed",
      summary,
      toolExecutionId: "tool-1",
      toolExecutionReceiptId: "receipt-1",
      now,
    });

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "assurance_scan_BUILD-1_tool-1",
        scopeType: "build",
        scopeId: "BUILD-1",
        adapterKey: "pnpm-audit",
        adapterVersion: "1.2.3",
        status: "failed",
        summary,
        startedAt: now,
        completedAt: now,
        buildId: "BUILD-1",
        digitalProductId: "product-1",
        toolExecutionId: "tool-1",
        toolExecutionReceiptId: "receipt-1",
      },
    });
  });

  it("threads the injected `now` into both startedAt and completedAt", async () => {
    const now = new Date("2020-01-02T03:04:05.000Z");
    const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({
      id: "run-db-2",
      runId: "assurance_bom_B_T",
    }));
    const db = { assuranceRun: { create } };

    await createAssuranceRun(db, {
      prefix: "assurance_bom_",
      buildId: "B",
      digitalProductId: null,
      adapterKey: "cyclonedx-pnpm-lock",
      adapterVersion: "1.0.0",
      status: "passed",
      summary: { componentCount: 3 },
      toolExecutionId: "T",
      toolExecutionReceiptId: "R",
      now,
    });

    const data = create.mock.calls[0][0].data;
    expect(data.startedAt).toBe(now);
    expect(data.completedAt).toBe(now);
    expect(data.scopeType).toBe("build");
    expect(data.scopeId).toBe("B");
    expect(data.digitalProductId).toBeNull();
  });
});
