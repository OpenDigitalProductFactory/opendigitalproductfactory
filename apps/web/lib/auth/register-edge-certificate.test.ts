import { describe, expect, it, vi } from "vitest";

import { registerEdgeNodeCertificate } from "./register-edge-certificate";

const NOW = new Date("2026-07-22T02:30:00.000Z");
const metadata = {
  fingerprintSha256: "a".repeat(64),
  serialNumber: "01AB",
  subject: "CN=dpf-edge-host-one",
  issuer: "CN=DPF Organization Intermediate CA",
  clientAuth: true,
  validFrom: new Date("2026-07-22T02:00:00.000Z"),
  validUntil: new Date("2026-08-21T02:00:00.000Z"),
};

function db(existing: { id: string; edgeNodeId: string } | null = null) {
  const store = {
    edgeNodeCertificate: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({ id: "cert-row-1", certificateId: "edgecert_1" }),
      update: vi.fn().mockResolvedValue({ id: existing?.id ?? "cert-row-1", certificateId: "edgecert_1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { ...store, $transaction: vi.fn((operation) => operation(store)) };
}

describe("registerEdgeNodeCertificate", () => {
  it("binds a valid client-only Edge certificate to the bearer-authenticated node", async () => {
    const store = db();
    const result = await registerEdgeNodeCertificate(store, {
      edgeNodeRowId: "edge-row-1",
      metadata,
      now: NOW,
      certificateId: "edgecert_1",
    });
    expect(result).toEqual({ ok: true, certificateId: "edgecert_1", created: true });
    expect(store.edgeNodeCertificate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        edgeNodeId: "edge-row-1",
        fingerprintSha256: "a".repeat(64),
        provisioner: "dpf-edge-client",
        status: "active",
      }),
    });
  });

  it("rejects server/general certificates and invalid validity windows", async () => {
    expect(await registerEdgeNodeCertificate(db(), { edgeNodeRowId: "edge-row-1", metadata: { ...metadata, clientAuth: false }, now: NOW, certificateId: "edgecert_1" })).toEqual({ ok: false, error: "client_auth_required" });
    expect(await registerEdgeNodeCertificate(db(), { edgeNodeRowId: "edge-row-1", metadata: { ...metadata, subject: "CN=portal.internal" }, now: NOW, certificateId: "edgecert_1" })).toEqual({ ok: false, error: "wrong_certificate_profile" });
    expect(await registerEdgeNodeCertificate(db(), { edgeNodeRowId: "edge-row-1", metadata: { ...metadata, validUntil: NOW }, now: NOW, certificateId: "edgecert_1" })).toEqual({ ok: false, error: "certificate_expired" });
  });

  it("rejects a fingerprint already bound to another node", async () => {
    expect(await registerEdgeNodeCertificate(db({ id: "cert-row-1", edgeNodeId: "edge-row-2" }), { edgeNodeRowId: "edge-row-1", metadata, now: NOW, certificateId: "edgecert_1" })).toEqual({ ok: false, error: "certificate_already_bound" });
  });

  it("is idempotent for the same node and fingerprint", async () => {
    const store = db({ id: "cert-row-1", edgeNodeId: "edge-row-1" });
    expect(await registerEdgeNodeCertificate(store, { edgeNodeRowId: "edge-row-1", metadata, now: NOW, certificateId: "ignored" })).toEqual({ ok: true, certificateId: "edgecert_1", created: false });
    expect(store.edgeNodeCertificate.create).not.toHaveBeenCalled();
  });

  it("atomically supersedes an older active certificate when a node renews", async () => {
    const store = db();
    await registerEdgeNodeCertificate(store, {
      edgeNodeRowId: "edge-row-1",
      metadata,
      now: NOW,
      certificateId: "edgecert_2",
    });

    expect(store.$transaction).toHaveBeenCalledOnce();
    expect(store.edgeNodeCertificate.updateMany).toHaveBeenCalledWith({
      where: {
        edgeNodeId: "edge-row-1",
        status: "active",
        fingerprintSha256: { not: "a".repeat(64) },
      },
      data: {
        status: "superseded",
        revokedAt: NOW,
        revocationReason: "certificate_renewed",
      },
    });
    expect(store.edgeNodeCertificate.create).toHaveBeenCalled();
  });
});
