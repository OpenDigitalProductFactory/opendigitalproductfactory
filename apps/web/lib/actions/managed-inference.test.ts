import { beforeEach, expect, it, vi } from "vitest";
import { createManagedInferenceRequestId } from "@/lib/remote-action/managed-inference-request";
import { QuiescenceStartUncertainError } from "@/lib/self-upgrade/quiescence-start-reservation";
const m = vi.hoisted(() => ({ read: vi.fn(), start: vi.fn(), fail: vi.fn(), build: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), connection: vi.fn(), employee: vi.fn(), register: vi.fn(), approve: vi.fn(), queue: vi.fn(), grant: vi.fn(), serialize: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: async () => ({ userId: "operator" }) }));
vi.mock("@/lib/identity/principal-linking", () => ({ resolveActiveHumanPrincipalRecordIdForUser: async () => "human-principal" }));
vi.mock("@/lib/remote-action/managed-inference-request-state", () => ({ readManagedInferenceRequestState: m.read }));
vi.mock("@/lib/remote-action/managed-inference-admission", () => ({ managedInferenceProviderDigest: () => "a".repeat(64), managedInferenceProviderAllowsTransition: (_provider: unknown, connection: { status: string } | null) => connection?.status === "active" }));
vi.mock("@/lib/remote-action/managed-inference-action", () => ({ buildManagedInferenceOffer: m.build, MANAGED_INFERENCE_UNSETTLED_WHERE: { actionType: "inference.runtime.transition" } }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ startQuiescence: m.start, signalSwapStarting: vi.fn(), failQuiescenceSwap: m.fail }));
vi.mock("@/lib/change-management/register-change", () => ({ registerChange: m.register }));
vi.mock("@/lib/self-upgrade/quiescence-start-reservation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/self-upgrade/quiescence-start-reservation")>(),
  withQuiescenceStartSerialization: m.serialize,
}));
vi.mock("@dpf/db", () => ({ prisma: {
  edgeNode: { findMany: m.findMany }, nonProductionEnvironmentLease: { findMany: m.findMany }, workroom: { findMany: m.findMany },
  remoteAction: { findFirst: m.findFirst }, modelProvider: { findUnique: m.findUnique }, quiescenceRun: { findFirst: m.findFirst },
  platformConfig: { findUnique: m.findUnique }, aiProviderConnection: { findUnique: m.connection },
  employeeProfile: { findUnique: m.employee }, changeRequest: { update: m.approve },
} }));
import { requestManagedInferenceTransition } from "./managed-inference";
const input = () => ({ requestId: createManagedInferenceRequestId(), operation: "activate" as const, offerToken: "a".repeat(64), operatorConfirmed: true, allowNodeAction: false });
beforeEach(() => { vi.resetAllMocks(); process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true"; m.findMany.mockResolvedValue([]); m.findFirst.mockResolvedValue(null);m.findUnique.mockResolvedValue(null); m.connection.mockResolvedValue({ status: "active" }); m.employee.mockResolvedValue({ id: "employee-record" }); m.fail.mockResolvedValue(undefined); });
it("observes a recorded original request instead of creating another pause or action", async () => {
  m.read.mockResolvedValue({ recorded: true, message: "The original request is still preparing." });
  expect((await requestManagedInferenceTransition(input())).ok).toBe(false);
  expect(m.start).not.toHaveBeenCalled(); expect(m.build).not.toHaveBeenCalled();
});
it("rejects expired request identities without renewing their acceptance window", async () => {
  expect((await requestManagedInferenceTransition({ ...input(), requestId: createManagedInferenceRequestId(Date.now() - 130000) })).ok).toBe(false);
  expect(m.start).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
});
it("retains the original prequeue identity after a lost start acknowledgement and never clears a different pause", async () => {
  const request = input();
  m.read.mockResolvedValue({ recorded: false });
  m.build.mockReturnValue({ available: true, token: request.offerToken, needsNodeGrant: false,
    parameters: { sourceSha: "a".repeat(40), profileSha256: "b".repeat(64) } });
  m.start.mockImplementation(async () => { m.read.mockResolvedValue({ recorded: true, message: "Original request preparing." }); throw new QuiescenceStartUncertainError("QR-original"); });
  expect((await requestManagedInferenceTransition(request)).ok).toBe(false);
  expect(m.start).toHaveBeenCalledWith(expect.objectContaining({ triggerRefId: `inference-runtime:ra_native_${request.requestId}`, ifBusy: "refuse", requestNotAfter: expect.any(Date) }));
  expect(m.fail).not.toHaveBeenCalled();
  await requestManagedInferenceTransition(request);
  expect(m.start).toHaveBeenCalledTimes(1); expect(m.fail).not.toHaveBeenCalled();
});

it.each(["paused", "disabled"])("refuses a %s default local connection after the offer without queueing a host switch", async status => {
  const request = input();
  m.read.mockResolvedValue({ recorded: false });
  m.build.mockReturnValue({ available: true, token: request.offerToken, needsNodeGrant: false,
    parameters: { sourceSha: "a".repeat(40), profileSha256: "b".repeat(64) } });
  m.start.mockResolvedValue({ runId: "QR-owned", awaitReady: async () => { m.connection.mockResolvedValue({ status }); return { ok: true }; } });
  expect((await requestManagedInferenceTransition(request)).ok).toBe(false);
  expect(m.build).toHaveBeenCalledTimes(1);
  expect(m.fail).toHaveBeenCalledWith("QR-owned", "Native inference offer changed before queueing");
});

function readyTransition(operation: "activate" | "rollback") {
  const request = { ...input(), operation };
  const parameters = { sourceSha: "b".repeat(40), profileSha256: "c".repeat(64), leaseId: "NPEL-owned" };
  const lease = { ...parameters, status: "active", phase: "running", releasedAt: null, expiresAt: new Date(Date.now() + 60000),
    ownerPid: 123, ownerProcessIdentity: "owned-process", ownerSessionId: "owned-session", branchName: "codex/owned" };
  m.read.mockResolvedValue({ recorded: false });
  m.build.mockReturnValue({ available: true, token: request.offerToken, needsNodeGrant: false, edgeNodeId: "node-record",
    nodeId: "edge-host", providerDigest: "a".repeat(64), parameters, lease, impact: "Switch the tested engine" });
  m.start.mockResolvedValue({ runId: "QR-owned", awaitReady: async () => ({ ok: true }) });
  m.register.mockResolvedValue({ id: "change-record", rfcId: "RFC-owned" });
  // Enforce the actual schema boundary: User.id is not EmployeeProfile.id.
  // A permissive update stub hid the production foreign-key failure.
  m.approve.mockImplementation(async ({ data }: { data: { approvedById: string } }) => {
    if (data.approvedById !== "employee-record") throw new Error("ChangeRequest_approvedById_fkey");
    return { id: "change-record" };
  });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    edgeNode: { findUnique: vi.fn().mockResolvedValue({ id: "node-record", nodeId: "edge-host", trustState: "trusted",
      scopePolicy: { actionTypes: ["inference.runtime.transition"] } }), update: m.grant },
    edgeNodeCapability: { findUnique: vi.fn().mockResolvedValue({ mode: "enabled" }) },
    nonProductionEnvironmentLease: { findUnique: vi.fn().mockResolvedValue(lease) },
    modelProvider: { findUnique: vi.fn().mockResolvedValue(null) },
    quiescenceRun: { findUnique: vi.fn().mockResolvedValue({ triggerRefId: `inference-runtime:ra_native_${request.requestId}`,
      status: "swapping", targetVersion: parameters.sourceSha, targetBundleHash: parameters.profileSha256 }) },
    platformConfig: { findUnique: vi.fn().mockResolvedValue({ value: { runId: "QR-owned", level: "swapping" } }) },
    aiProviderConnection: { findUnique: m.connection },
    remoteAction: { count: vi.fn().mockResolvedValue(0), create: m.queue },
  };
  m.serialize.mockImplementation(async (_db: unknown, _key: string, fn: (port: unknown) => Promise<unknown>) => fn(tx));
  return request;
}

it.each(["activate", "rollback"] as const)("prepares %s with the linked employee approver and original human principal", async operation => {
  const request = readyTransition(operation);
  expect(await requestManagedInferenceTransition(request)).toEqual({ ok: true, data: { actionKey: `ra_native_${request.requestId}`, rfcId: "RFC-owned" } });
  expect(m.employee).toHaveBeenCalledWith({ where: { userId: "operator" }, select: { id: true } });
  expect(m.approve).toHaveBeenCalledWith({ where: { id: "change-record" }, data: { approvedById: "employee-record" } });
  expect(m.queue).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    changeRequestId: "change-record", requestedByPrincipalId: "human-principal", approvedByPrincipalId: "human-principal", status: "queued",
  }) }));
  expect(m.grant).not.toHaveBeenCalled();
});

it("refuses a missing employee link before pausing work or creating approval and host effects", async () => {
  const request = readyTransition("activate");
  m.employee.mockResolvedValue(null);
  expect(await requestManagedInferenceTransition(request)).toEqual({ ok: false, error: "This change needs an employee profile linked to your operator account." });
  for (const effect of [m.start, m.register, m.approve, m.serialize, m.grant, m.queue]) expect(effect).not.toHaveBeenCalled();
});
