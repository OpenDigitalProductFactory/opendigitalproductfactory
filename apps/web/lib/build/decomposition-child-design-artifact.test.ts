import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const buildFindFirst = vi.fn();
vi.mock("@dpf/db", () => ({
  prisma: {
    buildArtifactRevision: { findFirst: (...a: unknown[]) => findFirst(...a) },
    featureBuild: { findFirst: (...a: unknown[]) => buildFindFirst(...a) },
  },
}));

const saveBuildArtifactRevision = vi.fn();
vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevision: (...a: unknown[]) => saveBuildArtifactRevision(...a),
}));

import { healDecompositionChildDesignArtifact } from "./decomposition-child-design-artifact";

const CHILD = {
  buildId: "FB-CHILD",
  parentEpicId: "epic-row-1",
  designDoc: { problemStatement: "p", proposedApproach: "a" },
  createdById: "user-1",
};

describe("healDecompositionChildDesignArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveBuildArtifactRevision.mockResolvedValue({ status: "accepted" });
  });

  it("mints the missing artifact and reports the heal", async () => {
    findFirst.mockResolvedValueOnce(null);              // child has no accepted revision
    buildFindFirst.mockResolvedValueOnce({ buildId: "FB-PARENT" });
    findFirst.mockResolvedValueOnce({ savedByAgentId: "AGT-PARENT" });

    await expect(healDecompositionChildDesignArtifact({ child: CHILD })).resolves.toBe(true);
    expect(saveBuildArtifactRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: "FB-CHILD",
        field: "designDoc",
        savedByUserId: "user-1",
        savedByAgentId: "AGT-PARENT",
      }),
    );
  });

  it("is idempotent — does nothing when an accepted revision already exists", async () => {
    // The resume path calls this on every tick, so a second call must not
    // stack revisions or report a heal that did not happen.
    findFirst.mockResolvedValueOnce({ id: "rev-1" });
    await expect(healDecompositionChildDesignArtifact({ child: CHILD })).resolves.toBe(false);
    expect(saveBuildArtifactRevision).not.toHaveBeenCalled();
  });

  it("records no author rather than inventing one when the parent has none", async () => {
    findFirst.mockResolvedValueOnce(null);
    buildFindFirst.mockResolvedValueOnce({ buildId: "FB-PARENT" });
    findFirst.mockResolvedValueOnce(null);             // parent has no accepted revision

    await healDecompositionChildDesignArtifact({ child: CHILD });
    expect(saveBuildArtifactRevision).toHaveBeenCalledWith(
      expect.objectContaining({ savedByAgentId: null }),
    );
  });

  it("does NOT claim a heal when the revision comes back `warning`", async () => {
    // A warning revision does not satisfy CANONICAL_DESIGN_REQUIRED, so
    // reporting success would move the build's story forward while the gate
    // stays exactly where it was.
    findFirst.mockResolvedValueOnce(null);
    buildFindFirst.mockResolvedValueOnce(null);
    saveBuildArtifactRevision.mockResolvedValue({ status: "warning" });

    await expect(healDecompositionChildDesignArtifact({ child: CHILD })).resolves.toBe(false);
  });

  it("no-ops for a build carrying no design at all", async () => {
    await expect(
      healDecompositionChildDesignArtifact({ child: { ...CHILD, designDoc: null } }),
    ).resolves.toBe(false);
    expect(saveBuildArtifactRevision).not.toHaveBeenCalled();
  });
});
