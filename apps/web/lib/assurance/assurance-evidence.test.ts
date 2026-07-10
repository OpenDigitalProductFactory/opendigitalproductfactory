// EP-8DC217EB BET-12 — assurance run → ComplianceEvidence projector + record tests.
import { describe, expect, it, vi, beforeEach } from "vitest";

const upsert = vi.fn(async () => ({}));

vi.mock("@dpf/db", () => ({
  prisma: {
    complianceEvidence: { upsert },
  },
}));

import {
  assuranceRunToEvidenceInput,
  recordAssuranceRunEvidence,
  type AssuranceRunEvidenceView,
} from "./assurance-evidence";

const run: AssuranceRunEvidenceView = {
  runId: "assurance_scan_BUILD-1_tool-1",
  adapterKey: "pnpm-audit",
  status: "failed",
  scopeType: "build",
  scopeId: "BUILD-1",
  summary: "1 findings (1 blocking)",
  startedAt: new Date("2026-05-22T00:00:00.000Z"),
  completedAt: new Date("2026-05-22T00:01:00.000Z"),
};

describe("assuranceRunToEvidenceInput", () => {
  it("keys the evidenceId on the run and carries the assurance fields", () => {
    const e = assuranceRunToEvidenceInput(run);

    expect(e.evidenceId).toBe("assurance-run:assurance_scan_BUILD-1_tool-1");
    expect(e.evidenceType).toBe("supply-chain-assurance");
    expect(e.status).toBe("active");
    expect(e.title).toContain("pnpm-audit");
    expect(e.description).toMatch(/supply-chain assurance runs on every build/);
    expect(e.description).toContain("failed");
    expect(e.description).toContain("1 findings (1 blocking)");
    expect(e.description).toContain(run.startedAt.toISOString());
  });

  it("omits the completion timestamp when the run has not completed", () => {
    const e = assuranceRunToEvidenceInput({ ...run, completedAt: null });
    expect(e.description).not.toContain("completed 2026");
  });
});

describe("recordAssuranceRunEvidence", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("upserts the projected evidence on the run-keyed evidenceId", async () => {
    const result = await recordAssuranceRunEvidence(run);

    expect(result).toEqual({ evidenceId: "assurance-run:assurance_scan_BUILD-1_tool-1" });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { evidenceId: "assurance-run:assurance_scan_BUILD-1_tool-1" },
        create: expect.objectContaining({ evidenceType: "supply-chain-assurance" }),
      }),
    );
  });
});
