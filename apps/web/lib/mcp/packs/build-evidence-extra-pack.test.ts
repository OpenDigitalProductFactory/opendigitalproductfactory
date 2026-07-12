import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  featureBuildFindFirst: vi.fn(),
  featureBuildFindUnique: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a),
    },
  },
}));

const recordExternalEvidence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: (...a: unknown[]) => recordExternalEvidence(...a),
}));

import { buildEvidenceExtraPack } from "./build-evidence-extra-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "save_build_notes",
  "save_phase_handoff",
  "record_external_development_evidence",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("build-evidence-extra pack — registration", () => {
  it("exposes exactly the three evidence tools with a handler each", () => {
    expect(buildEvidenceExtraPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildEvidenceExtraPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildEvidenceExtraPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: evidence writers need write grants", () => {
    expect(buildEvidenceExtraPack.grants.save_build_notes).toEqual(["build_evidence"]);
    expect(buildEvidenceExtraPack.grants.save_phase_handoff).toEqual(["backlog_write"]);
    expect(buildEvidenceExtraPack.grants.record_external_development_evidence).toEqual(["backlog_write"]);

    expect(isToolAllowedByGrants("save_build_notes", ["build_evidence"])).toBe(true);
    expect(isToolAllowedByGrants("save_phase_handoff", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_external_development_evidence", ["backlog_write"])).toBe(true);
  });
});

describe("build-evidence-extra pack — handler behavior (delegation preserved)", () => {
  it("save_build_notes reports the no-active-build state", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    const res = await buildEvidenceExtraPack.handlers.save_build_notes({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("save_phase_handoff reports the no-active-build state", async () => {
    db.featureBuildFindFirst.mockResolvedValue(null);
    const res = await buildEvidenceExtraPack.handlers.save_phase_handoff({ summary: "done" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
  });

  it("record_external_development_evidence rejects missing required fields", async () => {
    const res = await buildEvidenceExtraPack.handlers.record_external_development_evidence({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_required");
    expect(recordExternalEvidence).not.toHaveBeenCalled();
  });

  it("record_external_development_evidence forbids attaching to a build owned by another user", async () => {
    db.featureBuildFindUnique.mockResolvedValue({ createdById: "someone-else" });
    const res = await buildEvidenceExtraPack.handlers.record_external_development_evidence(
      {
        provider: "claude",
        externalSessionId: "sess-1",
        summary: "handoff",
        routeContext: "/build",
        buildId: "FB-OWNED-BY-OTHER",
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("forbidden");
    expect(recordExternalEvidence).not.toHaveBeenCalled();
  });
});
