import { describe, expect, it, vi } from "vitest";

import {
  DOCKER_VM_RESTART_IMPACT,
  changeStepsForRestartReport,
  checkDockerVmRestart,
  queueDockerVmRestart,
  type DockerVmRestartDeps,
} from "./docker-vm-restart-action";

const NOW = new Date("2026-10-07T12:00:00.000Z");

const hostNode = {
  id: "edge_row_1",
  nodeId: "edge-native-host",
  trustState: "trusted",
  customerAccountId: null,
  scopePolicy: { actionTypes: ["substrate.docker-vm.restart"] },
  capabilityRows: [{ capability: "action.execute", mode: "enabled" }],
};

function deps(over: Partial<DockerVmRestartDeps> = {}): DockerVmRestartDeps {
  return {
    findOpenWedgedIssue: async () => ({ summary: "2 processes stuck", observedAt: "2026-10-07T11:50:00.000Z" }),
    findActiveRestart: async () => null,
    findHostExecutors: async () => [hostNode],
    countRunningGates: async () => 1,
    registerApprovedChange: vi.fn(async () => ({ id: "cr_1", rfcId: "RFC-1" })),
    createAction: vi.fn(async ({ actionKey }: { actionKey: string }) => ({ actionKey })),
    now: () => NOW,
    actionKeyFactory: () => "ra_vm_1",
    ...over,
  };
}

describe("checkDockerVmRestart (BI-F8F8C383)", () => {
  it("is offered only while the wedged-VM condition is open", async () => {
    const result = await checkDockerVmRestart(deps({ findOpenWedgedIssue: async () => null }));
    expect(result).toMatchObject({ offered: false, reason: "no-wedged-vm" });
  });

  it("refuses a second restart while one is queued or running", async () => {
    const result = await checkDockerVmRestart(deps({ findActiveRestart: async () => ({ actionKey: "ra_old", status: "claimed" }) }));
    expect(result).toMatchObject({ offered: false, reason: "restart-already-in-flight" });
  });

  it("says plainly when no host executor can run it, and how to get one", async () => {
    const result = await checkDockerVmRestart(deps({ findHostExecutors: async () => [] }));
    expect(result).toMatchObject({ offered: false, reason: "no-host-executor" });
    if (!result.offered) expect(result.message).toMatch(/edge node on the host/);
  });

  it("ignores nodes that are untrusted, capability-disabled, not allowlisted or customer-scoped", async () => {
    const result = await checkDockerVmRestart(deps({
      findHostExecutors: async () => [
        { ...hostNode, trustState: "pending" },
        { ...hostNode, capabilityRows: [{ capability: "action.execute", mode: "disabled" }] },
        { ...hostNode, scopePolicy: { actionTypes: ["inventory.collect"] } },
        { ...hostNode, customerAccountId: "cust_1" },
      ],
    }));
    expect(result).toMatchObject({ offered: false, reason: "no-host-executor" });
  });

  it("on a native Linux Engine says only a reboot clears it, instead of offering a restart that cannot work (BI-28EFE18A)", async () => {
    const result = await checkDockerVmRestart(deps({
      findHostExecutors: async () => [{
        ...hostNode,
        capabilityRows: [{ capability: "action.execute", mode: "enabled", evidence: { dockerRuntime: "engine" } }],
      }],
    }));
    expect(result).toMatchObject({ offered: false, reason: "host-reboot-required" });
    if (!result.offered) expect(result.message).toMatch(/rebooting the host/);
  });

  it("offers the restart on Docker Desktop on any platform", async () => {
    const result = await checkDockerVmRestart(deps({
      findHostExecutors: async () => [{
        ...hostNode,
        capabilityRows: [{ capability: "action.execute", mode: "enabled", evidence: { dockerRuntime: "desktop" } }],
      }],
    }));
    expect(result.offered).toBe(true);
  });

  it("names the impact, including running gates, and that it is not a host reboot", async () => {
    const result = await checkDockerVmRestart(deps());
    expect(result.offered).toBe(true);
    if (result.offered) {
      expect(result.impact).toContain(DOCKER_VM_RESTART_IMPACT);
      expect(result.impact).toMatch(/1 running local-CI gate/);
      expect(result.edgeNodeId).toBe("edge_row_1");
    }
    expect(DOCKER_VM_RESTART_IMPACT).toMatch(/not a host reboot/i);
  });
});

describe("queueDockerVmRestart (BI-F8F8C383)", () => {
  it("never runs without the operator's explicit confirmation", async () => {
    const d = deps();
    const result = await queueDockerVmRestart(d, { requestedByUserId: "u1", requestedByPrincipalId: "p1", operatorConfirmed: false });
    expect(result).toMatchObject({ queued: false, reason: "operator-confirmation-required" });
    expect(d.createAction).not.toHaveBeenCalled();
  });

  it("records an approved change and a machine-bound, high-risk action for the host executor", async () => {
    const d = deps();
    const result = await queueDockerVmRestart(d, { requestedByUserId: "u1", requestedByPrincipalId: "p1", operatorConfirmed: true });
    expect(result).toEqual({ queued: true, actionKey: "ra_vm_1", changeRequestId: "cr_1", rfcId: "RFC-1" });
    expect(d.registerApprovedChange).toHaveBeenCalledWith(expect.objectContaining({
      approvedByUserId: "u1",
      impactReport: expect.objectContaining({
        actionType: "substrate.docker-vm.restart",
        edgeNodeId: "edge_row_1",
        operatorConfirmation: true,
      }),
    }));
    expect(d.createAction).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: "ra_vm_1",
      actionType: "substrate.docker-vm.restart",
      edgeNodeId: "edge_row_1",
      customerAccountId: null,
      riskClass: "high",
      approvalState: "approved",
      status: "queued",
      changeRequestId: "cr_1",
      requestedByPrincipalId: "p1",
      approvedByPrincipalId: "p1",
      parameters: { issueKey: "substrate:docker-vm-wedged" },
    }));
  });

  it("re-checks the preconditions at queue time", async () => {
    const d = deps({ findOpenWedgedIssue: async () => null });
    const result = await queueDockerVmRestart(d, { requestedByUserId: "u1", requestedByPrincipalId: "p1", operatorConfirmed: true });
    expect(result).toMatchObject({ queued: false, reason: "no-wedged-vm" });
    expect(d.registerApprovedChange).not.toHaveBeenCalled();
  });
});

describe("changeStepsForRestartReport (BI-F8F8C383)", () => {
  it("moves the change in progress when the host starts", () => {
    expect(changeStepsForRestartReport("running").map((step) => step.status)).toEqual(["scheduled", "in-progress"]);
  });

  it("completes it as successful or unsuccessful, naming the host's error code", () => {
    expect(changeStepsForRestartReport("succeeded").at(-1)).toMatchObject({ status: "completed", extra: { outcome: "successful" } });
    const failed = changeStepsForRestartReport("failed", "docker_not_ready").at(-1);
    expect(failed).toMatchObject({ status: "completed", extra: { outcome: "unsuccessful" } });
    expect(String(failed?.extra?.outcomeNotes)).toContain("docker_not_ready");
  });
});

