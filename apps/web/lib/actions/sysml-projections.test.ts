import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: vi.fn(),
}));
vi.mock("@/lib/ea/reconcile-sysml-projections", () => ({
  reconcileSysmlProjections: vi.fn(),
}));

import { requireCapability } from "@/lib/actions/shared/guards";
import { reconcileSysmlProjections } from "@/lib/ea/reconcile-sysml-projections";
import { refreshSysmlProjections } from "./sysml-projections";

const summary = { status: "applied", created: 0, updated: 0, removed: 0 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCapability).mockResolvedValue({ userId: "user-1" });
  vi.mocked(reconcileSysmlProjections).mockResolvedValue({
    mcpAuthority: { ...summary, toolCount: 2, grantCount: 3 },
    coworkerAuthority: summary,
    valueStreams: summary,
    routes: summary,
    navigation: summary,
    codeStructure: summary,
    processModels: summary,
    skillToolchain: summary,
    operationalGraph: summary,
    networkTopology: summary,
    integrations: summary,
    scheduledJobs: summary,
    it4itCoverage: summary,
    securityPosture: summary,
    workPatternArchitecture: summary,
    federatedDemandArchitecture: summary,
    aiRoutingArchitecture: {
      ...summary,
      updated: 4,
      crossLayerLinked: 9,
      crossLayerUnresolved: 0,
      bpmn: summary,
      sysml: summary,
      archimate: summary,
    },
  });
});

describe("refreshSysmlProjections", () => {
  it("requires architecture-management permission and reports routing cross-view refresh", async () => {
    const result = await refreshSysmlProjections();

    expect(requireCapability).toHaveBeenCalledWith("manage_ea_model");
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      aiRoutingArchitecture: expect.objectContaining({
        updated: 4,
        crossLayerLinked: 9,
        crossLayerUnresolved: 0,
      }),
    }));
  });

  it("does not run reconciliation when permission is denied", async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(refreshSysmlProjections()).rejects.toThrow("Unauthorized");
    expect(reconcileSysmlProjections).not.toHaveBeenCalled();
  });
});
