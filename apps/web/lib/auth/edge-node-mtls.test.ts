import { describe, expect, it, vi } from "vitest";

import { resolveEdgeNodeMtls } from "./edge-node-mtls";

const NOW = new Date("2026-07-22T02:30:00.000Z");
const FINGERPRINT = "a".repeat(64);

function headers(over: Record<string, string> = {}): Headers {
  return new Headers({
    "x-dpf-mtls-proxy-secret": "proxy-secret-with-at-least-32-bytes",
    "x-dpf-edge-cert-fingerprint": FINGERPRINT,
    "x-dpf-edge-cert-serial": "01AB",
    ...over,
  });
}

function certificate(over: Record<string, unknown> = {}) {
  return {
    id: "cert_1",
    edgeNodeId: "edge_row_1",
    fingerprintSha256: FINGERPRINT,
    serialNumber: "01AB",
    status: "active",
    validFrom: new Date("2026-07-21T00:00:00.000Z"),
    validUntil: new Date("2026-08-21T00:00:00.000Z"),
    revokedAt: null,
    edgeNode: { trustState: "trusted", revokedAt: null },
    ...over,
  };
}

function db(row: ReturnType<typeof certificate> | null) {
  return {
    edgeNodeCertificate: {
      findUnique: vi.fn().mockResolvedValue(row),
    },
  };
}

describe("resolveEdgeNodeMtls", () => {
  it("accepts a Caddy-verified active certificate bound to the bearer-authenticated node", async () => {
    const result = await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate()), {
      proxySecret: "proxy-secret-with-at-least-32-bytes",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, certificateId: "cert_1", fingerprintSha256: FINGERPRINT });
  });

  it("rejects direct or spoofed requests without the private proxy assertion", async () => {
    expect(
      await resolveEdgeNodeMtls(headers({ "x-dpf-mtls-proxy-secret": "attacker" }), "edge_row_1", db(certificate()), {
        proxySecret: "proxy-secret-with-at-least-32-bytes",
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "untrusted_proxy" });
  });

  it("rejects unknown, revoked, expired, and not-yet-valid certificates", async () => {
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(null), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_unknown" });
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ status: "revoked", revokedAt: NOW })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_inactive" });
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ validUntil: new Date("2026-07-22T02:29:59.000Z") })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_expired" });
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ validFrom: new Date("2026-07-22T02:30:01.000Z") })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_not_yet_valid" });
  });

  it("rejects a valid certificate bound to another node or a revoked node", async () => {
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ edgeNodeId: "edge_row_2" })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_node_mismatch" });
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ edgeNode: { trustState: "revoked", revokedAt: NOW } })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "node_revoked" });
  });

  it("rejects a certificate for a quarantined or not-yet-approved node", async () => {
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ edgeNode: { trustState: "quarantined", revokedAt: null } })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "node_not_trusted" });
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ edgeNode: { trustState: "pending", revokedAt: null } })), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "node_not_trusted" });
  });

  it("rejects a serial mismatch even when the fingerprint row exists", async () => {
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": "FFFF" }), "edge_row_1", db(certificate()), { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW })).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
  });
});
