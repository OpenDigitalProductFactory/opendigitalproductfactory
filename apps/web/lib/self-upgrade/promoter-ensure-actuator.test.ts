import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ present: true, spawn: vi.fn() }));
vi.mock("../../../../scripts/lib/scope-writer-observation.mjs", async (load) => ({ ...await load<object>(), usesPrivateActuator: async () => true }));
vi.mock("./doctools-image-actuator", async (load) => ({
  ...await load<object>(),
  doctoolsDockerThroughActuator: async () => ({ exitCode: state.present ? 0 : 1, stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async (load) => ({ ...await load<object>(), spawn: state.spawn }));

import { ensurePromoterImage } from "./promoter";

describe("ensurePromoterImage in the qualified portal (BI-224F56F1)", () => {
  it("reports the installed promoter and never builds one", async () => {
    await expect(ensurePromoterImage()).resolves.toEqual({ ok: true, alreadyPresent: true, built: false });
    state.present = false;
    await expect(ensurePromoterImage()).resolves.toMatchObject({ ok: false, built: false });
    expect(state.spawn).not.toHaveBeenCalled();
  });
});
