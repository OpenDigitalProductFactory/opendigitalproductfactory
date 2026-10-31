import { X509Certificate } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { resolveEdgeNodeMtls } from "./edge-node-mtls";

const NOW = new Date("2026-07-22T02:30:00.000Z");
const FINGERPRINT = "a".repeat(64);

function headers(over: Record<string, string> = {}): Headers {
  return new Headers({
    "x-dpf-mtls-proxy-secret": "proxy-secret-with-at-least-32-bytes",
    "x-dpf-edge-cert-fingerprint": FINGERPRINT,
    "x-dpf-edge-cert-serial": "427",
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

// Fictional public certificate only; its private test key was discarded.
const LARGE_SERIAL_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIBiDCCAS6gAwIBAgIHIAAAAAAAATAKBggqhkjOPQQDAjAgMR4wHAYDVQQDDBVk
cGYtZWRnZS11bml0LWZpeHR1cmUwHhcNMjYxMDMwMDUyMTMxWhcNMjYxMTAxMDUy
MTMxWjAgMR4wHAYDVQQDDBVkcGYtZWRnZS11bml0LWZpeHR1cmUwWTATBgcqhkjO
PQIBBggqhkjOPQMBBwNCAASg/UMLhPhzWrKH2E05YZvx+gDH+dLpf3y+GYCYvLCT
Y0Ig4D91XYELtgX/y98H9NRAVcEC+UF0rSKseYEOgDyDo1MwUTAdBgNVHQ4EFgQU
x5jvnAwgXAYyMnV4XBbg7uuD28kwHwYDVR0jBBgwFoAUx5jvnAwgXAYyMnV4XBbg
7uuD28kwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBt0gEzitXe
3tR/3ZejfFuv91Q39TlABS1YPLcnseJoEgIhAOYnWvtQBbQ3fvd0NEWFWo0TM9+Z
+VYcmntiN4maQeX6
-----END CERTIFICATE-----`;

describe("resolveEdgeNodeMtls", () => {
  it("accepts Caddy's decimal serial for the registered X509 hex certificate", async () => {
    const result = await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate()), {
      proxySecret: "proxy-secret-with-at-least-32-bytes",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, certificateId: "cert_1", fingerprintSha256: FINGERPRINT });
  });

  it.each(["01AB", "1aB", "00:01:aB", "000001ab"])("accepts stored hex normalization %s with decimal wire 427", async (serialNumber) => {
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ serialNumber })), {
      proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW,
    })).toMatchObject({ ok: true });
  });

  it("never guesses the base of a digits-only registered serial", async () => {
    const row = certificate({ serialNumber: "0010" });
    const options = { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW };
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": "16" }), "edge_row_1", db(row), options)).toMatchObject({ ok: true });
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": "10" }), "edge_row_1", db(row), options)).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
  });

  it("matches a real X509 serial beyond 53 bits exactly and rejects adjacent decimal values", async () => {
    const x509 = new X509Certificate(LARGE_SERIAL_CERTIFICATE);
    expect(x509.serialNumber).toBe("20000000000001");
    const fingerprint = x509.fingerprint256.replaceAll(":", "").toLowerCase();
    const row = certificate({ serialNumber: x509.serialNumber, fingerprintSha256: fingerprint,
      validFrom: new Date(x509.validFrom), validUntil: new Date(x509.validTo) });
    const options = { proxySecret: "proxy-secret-with-at-least-32-bytes", now: new Date("2026-10-31T00:00:00Z") };
    const presented = (serial: string) => headers({ "x-dpf-edge-cert-fingerprint": fingerprint, "x-dpf-edge-cert-serial": serial });
    expect(await resolveEdgeNodeMtls(presented("9007199254740993"), "edge_row_1", db(row), options)).toMatchObject({ ok: true });
    for (const serial of ["9007199254740992", "9007199254740994"]) {
      expect(await resolveEdgeNodeMtls(presented(serial), "edge_row_1", db(row), options)).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
    }
  });

  it("accepts the positive 20-octet value bound and rejects larger values", async () => {
    const options = { proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW };
    const maximum = certificate({ serialNumber: "F".repeat(40) });
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": "1461501637330902918203684832716283019655932542975" }), "edge_row_1", db(maximum), options)).toMatchObject({ ok: true });
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": "1461501637330902918203684832716283019655932542976" }), "edge_row_1", db(certificate({ serialNumber: "10000000000000000000000000000000000000000" })), options)).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
  });

  it.each(["428", "01AB", "0x1ab", "-427", "+427", "4.27", "4e2", "4 27", "427x", "0", "00", "9".repeat(50), "0".repeat(1000) + "427"])("rejects wrong or malformed wire serial %s", async (serial) => {
    expect(await resolveEdgeNodeMtls(headers({ "x-dpf-edge-cert-serial": serial }), "edge_row_1", db(certificate()), {
      proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW,
    })).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
  });

  it.each(["", "0", "00", "-1", "0x1ab", "1g", " ", "0".repeat(129) + "1ab"])("rejects corrupt stored serial %s without throwing", async (serialNumber) => {
    expect(await resolveEdgeNodeMtls(headers(), "edge_row_1", db(certificate({ serialNumber })), {
      proxySecret: "proxy-secret-with-at-least-32-bytes", now: NOW,
    })).toEqual({ ok: false, error: "certificate_metadata_mismatch" });
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
