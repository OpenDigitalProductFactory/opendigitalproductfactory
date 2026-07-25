import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirror of the mock setup in lib/actions/build-governed.test.ts: `@dpf/db`'s
// prisma, `saveBuildArtifactRevision`, and (here) the auto-accept feature flag
// are the only IO edges. `getProcessPolicy` is deliberately NOT mocked — it is a
// pure lookup and using the real one validates the actual review->ship policy.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: {
      findUnique: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
  },
}));

const { mockSaveBuildArtifactRevision } = vi.hoisted(() => ({
  mockSaveBuildArtifactRevision: vi.fn(),
}));

const { mockIsEvidenceAutoAcceptEnabled } = vi.hoisted(() => ({
  mockIsEvidenceAutoAcceptEnabled: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevision: mockSaveBuildArtifactRevision,
}));

vi.mock("@/lib/integrate/build-studio-config", () => ({
  isEvidenceAutoAcceptEnabled: mockIsEvidenceAutoAcceptEnabled,
}));

import { autoAcceptBuildOnEvidence } from "./auto-accept";
// Real (unmocked) policy — asserted directly for the doc-exemption case.
import { getProcessPolicy } from "@/lib/explore/build-process-matrix";

type BuildRow = Record<string, unknown>;

/**
 * A fully-green (feature, medium) build row exactly as the `findUnique` `select`
 * in auto-accept.ts projects it. `plan: null` → processSize undefined → the
 * matrix resolves to feature·standard, whose review->ship gate DOES require
 * `acceptance-evaluated`, so this row is on the accept path. Every negative case
 * flips one field via `overrides`.
 */
function greenBuild(overrides: BuildRow = {}): BuildRow {
  return {
    phase: "review",
    kind: "feature",
    plan: null,
    brief: { acceptanceCriteria: ["AC1", "AC2"] },
    designDoc: null,
    verificationOut: {
      typecheckPassed: true,
      testsFailed: 0,
      testsPassed: 5,
      fullOutput: "",
      timestamp: "",
    },
    uxVerificationStatus: "complete",
    acceptanceMet: null,
    createdById: "user-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsEvidenceAutoAcceptEnabled.mockResolvedValue(true);
  // Fire-and-forget audit row (`.create(...).catch(...)`) — must be thenable.
  mockPrisma.buildActivity.create.mockResolvedValue({});
  mockSaveBuildArtifactRevision.mockResolvedValue({
    revisionId: "rev-1",
    revisionNumber: 1,
    status: "accepted",
    receiptIds: [],
    warnings: [],
    errors: [],
  });
});

describe("autoAcceptBuildOnEvidence — accepts on fully-green evidence", () => {
  it("ACCEPTS a fully-green feature build, writing acceptanceMet exactly once", async () => {
    // Sanity: the REAL feature·standard policy gates review->ship on acceptance.
    expect(getProcessPolicy("feature", "medium").gates["review->ship"]).toContain(
      "acceptance-evaluated",
    );
    mockPrisma.featureBuild.findUnique.mockResolvedValue(greenBuild());

    const result = await autoAcceptBuildOnEvidence("FB-GREEN");

    expect(result.accepted).toBe(true);
    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledTimes(1);

    const arg = mockSaveBuildArtifactRevision.mock.calls[0][0];
    expect(arg).toMatchObject({
      buildId: "FB-GREEN",
      field: "acceptanceMet",
      savedByUserId: "user-1",
    });
    expect(Array.isArray(arg.value)).toBe(true);
    expect(arg.value).toHaveLength(2);
    expect(arg.value.map((c: { criterion: string }) => c.criterion)).toEqual(["AC1", "AC2"]);
    for (const entry of arg.value as Array<{ criterion: string; met: boolean; evidence: string }>) {
      expect(entry.met).toBe(true);
      expect(typeof entry.criterion).toBe("string");
      expect(typeof entry.evidence).toBe("string");
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
    // The returned acceptanceMet mirrors what was written.
    expect(result.acceptanceMet).toEqual(arg.value);
    // Best-effort audit row distinguishes the machine path.
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ buildId: "FB-GREEN", tool: "auto_record_acceptance" }),
      }),
    );
  });

  it("ACCEPTS when uxVerificationStatus is 'skipped'", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ uxVerificationStatus: "skipped" }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-SKIPPED");

    expect(result.accepted).toBe(true);
    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledTimes(1);
    const arg = mockSaveBuildArtifactRevision.mock.calls[0][0];
    expect(arg.field).toBe("acceptanceMet");
    expect(arg.value).toHaveLength(2);
  });

  it("ACCEPTS using designDoc.acceptanceCriteria when the brief has none", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ brief: null, designDoc: { acceptanceCriteria: ["DD1", "DD2", "DD3"] } }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-DESIGNDOC");

    expect(result.accepted).toBe(true);
    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledTimes(1);
    const arg = mockSaveBuildArtifactRevision.mock.calls[0][0];
    expect(arg.value).toHaveLength(3);
    expect(arg.value.map((c: { criterion: string }) => c.criterion)).toEqual([
      "DD1",
      "DD2",
      "DD3",
    ]);
    for (const entry of arg.value as Array<{ met: boolean }>) expect(entry.met).toBe(true);
  });
});

describe("autoAcceptBuildOnEvidence — declines (no write) unless fully green", () => {
  it("declines when the feature flag is OFF (never reads the build)", async () => {
    mockIsEvidenceAutoAcceptEnabled.mockResolvedValue(false);
    mockPrisma.featureBuild.findUnique.mockResolvedValue(greenBuild());

    const result = await autoAcceptBuildOnEvidence("FB-FLAGOFF");

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("flag-off");
    expect(mockPrisma.featureBuild.findUnique).not.toHaveBeenCalled();
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when typecheck did not pass", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({
        verificationOut: {
          typecheckPassed: false,
          testsFailed: 0,
          testsPassed: 5,
          fullOutput: "",
          timestamp: "",
        },
      }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-TC");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  // Tests are ADVISORY, not gated. verificationOut.testsFailed is the whole apps/web
  // suite (repo-wide, incl. pre-existing failures unrelated to this build — builds have
  // completed at testsFailed=88), so gating on ===0 would couple acceptance to unrelated
  // repo test health. Typecheck (build-relevant) stays the hard gate; a non-zero or null
  // testsFailed still accepts when typecheck + UX + criteria are green.
  it("ACCEPTS despite repo-wide testsFailed > 0 (tests advisory)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({
        verificationOut: {
          typecheckPassed: true,
          testsFailed: 7,
          testsPassed: 1,
          fullOutput: "",
          timestamp: "",
        },
      }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-TF7");

    expect(result.accepted).toBe(true);
    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledTimes(1);
    expect(mockSaveBuildArtifactRevision.mock.calls[0][0].field).toBe("acceptanceMet");
  });

  it("ACCEPTS when testsFailed is null (tests advisory)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({
        verificationOut: {
          typecheckPassed: true,
          testsFailed: null,
          testsPassed: 0,
          fullOutput: "",
          timestamp: "",
        },
      }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-TFNULL");

    expect(result.accepted).toBe(true);
    expect(mockSaveBuildArtifactRevision).toHaveBeenCalledTimes(1);
  });

  it("declines when uxVerificationStatus is 'failed'", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ uxVerificationStatus: "failed" }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-UXFAIL");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when uxVerificationStatus is 'running'", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ uxVerificationStatus: "running" }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-UXRUN");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when uxVerificationStatus is null", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ uxVerificationStatus: null }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-UXNULL");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when no acceptance criteria are present (brief + designDoc absent)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ brief: null, designDoc: null }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-NOCRIT");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when acceptance criteria are present but empty", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ brief: { acceptanceCriteria: [] }, designDoc: null }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-EMPTYCRIT");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when acceptanceMet is already set (idempotent — no overwrite)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ acceptanceMet: [{ criterion: "AC1", met: true, evidence: "prior" }] }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-IDEMPOTENT");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines when the build is not in the 'review' phase", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(greenBuild({ phase: "build" }));

    const result = await autoAcceptBuildOnEvidence("FB-BUILDPHASE");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("declines a doc build whose review->ship policy does not require acceptance", async () => {
    // Prove, against the REAL matrix, that a doc build is exempt for the chosen
    // size — so a fully-green doc row must still be declined (write would be noise).
    expect(getProcessPolicy("doc", "small").gates["review->ship"]).not.toContain(
      "acceptance-evaluated",
    );
    mockPrisma.featureBuild.findUnique.mockResolvedValue(
      greenBuild({ kind: "doc", plan: { processSize: "small" } }),
    );

    const result = await autoAcceptBuildOnEvidence("FB-DOC");

    expect(result.accepted).toBe(false);
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });
});

describe("autoAcceptBuildOnEvidence — never throws (fail-closed)", () => {
  it("returns accepted:false with reason 'error' when findUnique rejects", async () => {
    mockPrisma.featureBuild.findUnique.mockRejectedValue(new Error("db exploded"));

    const result = await autoAcceptBuildOnEvidence("FB-BOOM");

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("error");
    expect(mockSaveBuildArtifactRevision).not.toHaveBeenCalled();
  });
});
