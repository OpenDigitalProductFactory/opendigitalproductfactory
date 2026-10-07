import { describe, expect, it, vi } from "vitest";

import {
  HOST_UPKEEP_ACTION_TYPES,
  convergeHostUpkeepOnInstallerNodes,
  type HostUpkeepConvergenceDb,
} from "./host-upkeep-convergence";

const NOW = new Date("2026-10-07T22:00:00.000Z");

function db(nodes: Array<{
  id: string;
  trustState: string;
  scopePolicy: unknown;
  capabilityRows: Array<{ capability: string; mode: string }>;
}>) {
  return {
    edgeNode: {
      findMany: vi.fn(async () => nodes),
      update: vi.fn(async () => ({})),
    },
    edgeNodeCapability: {
      upsert: vi.fn(async () => ({})),
    },
  } satisfies HostUpkeepConvergenceDb;
}

describe("convergeHostUpkeepOnInstallerNodes (BI-28EFE18A)", () => {
  it("enables action.execute and allowlists only the host-upkeep actions on the install's own trusted node", async () => {
    const d = db([{ id: "n1", trustState: "trusted", scopePolicy: null, capabilityRows: [] }]);
    const result = await convergeHostUpkeepOnInstallerNodes(d, { now: NOW });
    expect(result.converged).toEqual(["n1"]);
    expect(d.edgeNodeCapability.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { edgeNodeId_capability: { edgeNodeId: "n1", capability: "action.execute" } },
      create: expect.objectContaining({ mode: "enabled" }),
      update: { mode: "enabled" },
    }));
    expect(d.edgeNode.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        scopePolicy: {
          actionTypes: [...HOST_UPKEEP_ACTION_TYPES],
          hostUpkeep: { convergedAt: NOW.toISOString(), actionTypes: [...HOST_UPKEEP_ACTION_TYPES] },
        },
      },
    });
    expect(HOST_UPKEEP_ACTION_TYPES).toEqual(["substrate.docker-vm.restart"]);
  });

  it("keeps an operator's existing allowlist and adds only what is missing", async () => {
    const d = db([{ id: "n1", trustState: "trusted", scopePolicy: { actionTypes: ["inventory.collect"] }, capabilityRows: [] }]);
    await convergeHostUpkeepOnInstallerNodes(d, { now: NOW });
    const data = (d.edgeNode.update.mock.calls[0] as unknown as [{ data: { scopePolicy: { actionTypes: string[] } } }])[0].data;
    expect(data.scopePolicy.actionTypes).toEqual(["inventory.collect", "substrate.docker-vm.restart"]);
  });

  it("converges once: an operator who later disables it is never overridden", async () => {
    const d = db([{
      id: "n1",
      trustState: "trusted",
      scopePolicy: { actionTypes: [], hostUpkeep: { convergedAt: "2026-10-01T00:00:00.000Z", actionTypes: ["substrate.docker-vm.restart"] } },
      capabilityRows: [{ capability: "action.execute", mode: "disabled" }],
    }]);
    const result = await convergeHostUpkeepOnInstallerNodes(d, { now: NOW });
    expect(result.converged).toEqual([]);
    expect(d.edgeNodeCapability.upsert).not.toHaveBeenCalled();
    expect(d.edgeNode.update).not.toHaveBeenCalled();
  });

  it("never touches a node that is not trusted", async () => {
    const d = db([{ id: "n1", trustState: "pending", scopePolicy: null, capabilityRows: [] }]);
    expect((await convergeHostUpkeepOnInstallerNodes(d, { now: NOW })).converged).toEqual([]);
    expect(d.edgeNodeCapability.upsert).not.toHaveBeenCalled();
  });

  it("selects only this installation's installer-managed internal nodes", async () => {
    const d = db([]);
    await convergeHostUpkeepOnInstallerNodes(d, { now: NOW });
    expect(d.edgeNode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        trustState: { not: "revoked" },
        customerAccountId: null,
        customerSiteId: null,
        consumedTokens: { some: { autoApprove: true } },
      },
    }));
  });
});
