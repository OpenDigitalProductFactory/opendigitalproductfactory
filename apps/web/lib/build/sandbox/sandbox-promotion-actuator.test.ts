import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ exec: vi.fn(async () => ({ stdout: "", stderr: "" })), update: vi.fn() }));
vi.mock("../../../../../scripts/lib/scope-writer-observation.mjs", async (load) => ({ ...await load<object>(), usesPrivateActuator: async () => true }));
vi.mock("@/lib/shared/lazy-node", async (load) => ({ ...await load<object>(), lazyExec: () => state.exec }));
vi.mock("@dpf/db", () => ({ prisma: {
  changePromotion: { findUnique: async () => ({ promotionId: "CP-1", status: "approved", productVersion: { featureBuild: { buildId: "FB-1", sandboxId: null, diffPatch: "" } }, changeItem: null }), update: state.update },
} }));

import { executePromotion } from "./sandbox-promotion";

describe("ChangePromotion in the qualified portal (DI-062828328841)", () => {
  it("refuses before any backup, patch, migration or status change", async () => {
    await expect(executePromotion("CP-1")).resolves.toMatchObject({ success: false, step: "validate" });
    expect(state.exec).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });
});
