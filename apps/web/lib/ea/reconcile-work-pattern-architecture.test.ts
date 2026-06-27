import { describe, expect, it, vi } from "vitest";

vi.mock("./sysml-model-seed", () => ({
  applySysmlModel: vi.fn(async () => ({
    status: "applied",
    created: 1,
    updated: 2,
    removed: 0,
  })),
}));

import { applySysmlModel } from "./sysml-model-seed";
import { reconcileWorkPatternArchitecture } from "./reconcile-work-pattern-architecture";

describe("reconcileWorkPatternArchitecture", () => {
  it("applies the governed adaptive playbooks model under sysml2", async () => {
    const db = { eaNotation: {} };

    const result = await reconcileWorkPatternArchitecture({ db: db as never });

    expect(result).toEqual({ status: "applied", created: 1, updated: 2, removed: 0 });
    expect(applySysmlModel).toHaveBeenCalledWith(
      expect.objectContaining({
        softRemovePrefix: "gap:",
        view: expect.objectContaining({ scopeRef: "governed-adaptive-playbooks" }),
      }),
      { db, notationSlug: "sysml2" },
    );
  });
});
