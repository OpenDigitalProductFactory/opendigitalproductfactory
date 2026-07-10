// EP-8DC217EB BET-12 — generic recordComplianceEvidence unit tests.
import { describe, expect, it, vi, beforeEach } from "vitest";

const upsert = vi.fn(async (_args: unknown) => ({}));

vi.mock("@dpf/db", () => ({
  prisma: {
    complianceEvidence: { upsert },
  },
}));

import { recordComplianceEvidence, type ComplianceEvidenceInput } from "./compliance-evidence";

const sample: ComplianceEvidenceInput = {
  evidenceId: "assurance-run:run-1",
  title: "Run 1",
  evidenceType: "supply-chain-assurance",
  description: "A run happened.",
  status: "active",
};

describe("recordComplianceEvidence", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("upserts on evidenceId with the create body (new-evidence path)", async () => {
    const result = await recordComplianceEvidence(sample);

    expect(result).toEqual({ evidenceId: "assurance-run:run-1" });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith({
      where: { evidenceId: "assurance-run:run-1" },
      update: { title: "Run 1", description: "A run happened.", status: "active" },
      create: {
        evidenceId: "assurance-run:run-1",
        title: "Run 1",
        evidenceType: "supply-chain-assurance",
        description: "A run happened.",
        status: "active",
      },
    });
  });

  it("refreshes title/description/status via the update body (existing-evidence path)", async () => {
    await recordComplianceEvidence({ ...sample, title: "Run 1 (rerun)", status: "superseded" });

    const call = upsert.mock.calls[0][0] as unknown as {
      update: { title: string; description: string; status: string };
      create: { evidenceType: string };
    };
    // The update path must not touch evidenceType (immutable key metadata).
    expect(call.update).toEqual({
      title: "Run 1 (rerun)",
      description: "A run happened.",
      status: "superseded",
    });
    expect(call.create.evidenceType).toBe("supply-chain-assurance");
  });
});
