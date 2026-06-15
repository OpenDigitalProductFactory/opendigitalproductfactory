import { describe, expect, it, vi } from "vitest";
import { reconcileValueStreams } from "./reconcile-value-streams";

describe("reconcileValueStreams", () => {
  it("skips when the IT4IT reference model is not seeded", async () => {
    const db = {
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue(null) },
      eaReferenceModelElement: { findMany: vi.fn() },
    };
    const r = await reconcileValueStreams({ db: db as never });
    expect(r.status).toBe("skipped");
    expect(db.eaReferenceModelElement.findMany).not.toHaveBeenCalled();
  });

  it("queries the IT4IT value-stream + stage rows and threads them to the seeder", async () => {
    // notation absent → applySysmlModel skips, but the query path is still exercised.
    const db = {
      eaReferenceModel: { findUnique: vi.fn().mockResolvedValue({ id: "m1" }) },
      eaReferenceModelElement: {
        findMany: vi.fn().mockResolvedValue([
          { id: "vs1", kind: "value_stream", slug: "evaluate", name: "Evaluate", parentId: null },
          { id: "st1", kind: "value_stream_stage", slug: "eval-gather", name: "Gather", parentId: "vs1" },
        ]),
      },
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const r = await reconcileValueStreams({ db: db as never });
    expect(r.status).toBe("skipped");
    expect(db.eaReferenceModelElement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { modelId: "m1", kind: { in: ["value_stream", "value_stream_stage"] } },
      })
    );
  });
});
