import { beforeEach, expect, it, vi } from "vitest";
import { createManagedInferenceRequestId } from "@/lib/remote-action/managed-inference-request";
import { QuiescenceStartUncertainError } from "@/lib/self-upgrade/quiescence-start-reservation";
const m = vi.hoisted(() => ({ read: vi.fn(), start: vi.fn(), fail: vi.fn(), build: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: async () => ({ userId: "operator" }) }));
vi.mock("@/lib/identity/principal-linking", () => ({ resolveActiveHumanPrincipalRecordIdForUser: async () => "human-principal" }));
vi.mock("@/lib/remote-action/managed-inference-request-state", () => ({ readManagedInferenceRequestState: m.read }));
vi.mock("@/lib/remote-action/managed-inference-admission", () => ({ managedInferenceProviderDigest: () => "a".repeat(64) }));
vi.mock("@/lib/remote-action/managed-inference-action", () => ({ buildManagedInferenceOffer: m.build, MANAGED_INFERENCE_UNSETTLED_WHERE: { actionType: "inference.runtime.transition" } }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ startQuiescence: m.start, signalSwapStarting: vi.fn(), failQuiescenceSwap: m.fail }));
vi.mock("@/lib/change-management/register-change", () => ({ registerChange: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  edgeNode: { findMany: m.findMany }, nonProductionEnvironmentLease: { findMany: m.findMany }, workroom: { findMany: m.findMany },
  remoteAction: { findFirst: m.findFirst }, modelProvider: { findUnique: m.findUnique }, quiescenceRun: { findFirst: m.findFirst },
  platformConfig: { findUnique: m.findUnique },
} }));
import { requestManagedInferenceTransition } from "./managed-inference";
const input = () => ({ requestId: createManagedInferenceRequestId(), operation: "activate" as const, offerToken: "a".repeat(64), operatorConfirmed: true, allowNodeAction: false });
beforeEach(() => { vi.resetAllMocks(); process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true"; m.findMany.mockResolvedValue([]); m.findFirst.mockResolvedValue(null);m.findUnique.mockResolvedValue(null); });
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
