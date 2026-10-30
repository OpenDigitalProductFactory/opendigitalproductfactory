import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), mtls: vi.fn(), tx: vi.fn(), issue: vi.fn(), signer: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { $transaction: mocks.tx } }));
vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mocks.auth }));
vi.mock("@/lib/auth/edge-node-mtls", () => ({ resolveEdgeNodeMtls: mocks.mtls }));
vi.mock("@/lib/auth/edge-mtls-proxy-secret", () => ({ loadEdgeMtlsProxySecret: () => "proxy-secret" }));
vi.mock("@/lib/remote-action/action-signing-key", () => ({ loadEdgeActionSigner: mocks.signer }));
vi.mock("@/lib/remote-action/managed-inference-admission", () => ({ issueManagedInferenceAdmission: mocks.issue }));
import { POST } from "./route";

const request = (body: string) => new NextRequest("https://localhost/api/v1/edge/actions/inference-admission", {
  method: "POST", headers: { authorization: "Bearer local-fixture" }, body,
});
beforeEach(() => {
  vi.clearAllMocks(); process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true";
  mocks.auth.mockResolvedValue({ ok: true, edgeNodeRowId: "edge-row", nodeId: "edge-mac" });
  mocks.mtls.mockResolvedValue({ ok: true });
});
it("requires existing node bearer scope and machine identity before reading authority", async () => {
  mocks.mtls.mockResolvedValue({ ok: false });
  expect((await POST(request("{}"))).status).toBe(401);
  expect(mocks.auth).toHaveBeenCalledWith("Bearer local-fixture", "edge:actions:claim");
  expect(mocks.tx).not.toHaveBeenCalled();
});
it("refuses a caller assertion, malformed JSON or an oversized envelope", async () => {
  for (const body of ["{", JSON.stringify({ ready: true }), " ".repeat(17000)]) {
    expect((await POST(request(body))).status).toBeGreaterThanOrEqual(400);
  }
  expect(mocks.tx).not.toHaveBeenCalled();
});
it("does not renew leases or accept caller snapshots when current authority is unavailable", async () => {
  mocks.tx.mockRejectedValue(new Error("expired"));
  const response = await POST(request(JSON.stringify({ envelope: { actionKey: "RA-TEST", nodeId: "edge-mac" } })));
  expect(response.status).toBe(409);
  expect(mocks.tx).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  expect(mocks.issue).not.toHaveBeenCalled();
});
