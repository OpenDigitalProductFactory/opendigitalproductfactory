import { describe, expect, it, vi } from "vitest";

// BI-224F56F1: in the qualified portal (private actuator mounted, no Docker)
// teardown and preview sign-in refuse before any effect.
const state = vi.hoisted(() => ({
  secret: vi.fn(), swap: vi.fn(), dispatch: vi.fn(), lease: vi.fn(), execFile: vi.fn(),
}));
vi.mock("../../../../scripts/lib/scope-writer-observation.mjs", async (load) => ({ ...await load<object>(), usesPrivateActuator: async () => true }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: async () => ({ userId: "user-1" }) }));
vi.mock("@/lib/teardown/dispatcher", () => ({ dispatchTeardown: state.dispatch }));
vi.mock("@/lib/self-upgrade/quiescence", async (load) => ({ ...await load<object>(), signalSwapStarting: state.swap }));
vi.mock("node:fs/promises", async (load) => ({ ...await load<object>(), readFile: state.secret }));
vi.mock("node:child_process", async (load) => ({ ...await load<object>(), execFile: state.execFile }));
vi.mock("@dpf/db", () => ({ prisma: { nonProductionEnvironmentLease: { findUnique: state.lease } }, createDatabaseClient: vi.fn() }));

import { executeInstallationTeardown } from "./teardown";
import { issuePreviewAutomationSignIn } from "@/lib/govern/preview-automation-sign-in";

describe("qualified portal refusals", () => {
  it("refuses teardown before reading its secret, draining or launching", async () => {
    await expect(executeInstallationTeardown("challenge")).resolves.toMatchObject({ ok: false });
    expect(state.secret).not.toHaveBeenCalled();
    expect(state.swap).not.toHaveBeenCalled();
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("refuses preview sign-in before reading the lease or calling Docker", async () => {
    await expect(issuePreviewAutomationSignIn({ leaseId: "L-1", ownerSessionId: "s", userId: "user-1" }))
      .rejects.toThrow("preview_issuer_unavailable_in_qualified_portal");
    expect(state.lease).not.toHaveBeenCalled();
    expect(state.execFile).not.toHaveBeenCalled();
  });
});
