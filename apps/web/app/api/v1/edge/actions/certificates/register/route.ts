import { randomUUID, X509Certificate } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { isTrustedMtlsProxy } from "@/lib/auth/edge-node-mtls";
import { loadEdgeMtlsProxySecret } from "@/lib/auth/edge-mtls-proxy-secret";
import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import {
  registerEdgeNodeCertificate,
  type EdgeCertificateRegistrationDb,
} from "@/lib/auth/register-edge-certificate";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

const CLIENT_AUTH_OID = "1.3.6.1.5.5.7.3.2";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
    return NextResponse.json({ ok: false, error: "remote_action_dispatch_disabled" }, { status: 404 });
  }
  const authz = await resolveEdgeNodeAuth(request.headers.get("authorization"), "edge:actions:claim");
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: authz.error === "scope_disallowed" ? 403 : 401 });
  }
  let proxySecret: string;
  try {
    proxySecret = loadEdgeMtlsProxySecret();
  } catch {
    return NextResponse.json({ ok: false, error: "machine_authentication_unavailable" }, { status: 503 });
  }
  if (!isTrustedMtlsProxy(request.headers, proxySecret)) {
    return NextResponse.json({ ok: false, error: "machine_authentication_failed" }, { status: 401 });
  }

  const derBase64 = request.headers.get("x-dpf-edge-cert-der") ?? "";
  if (!derBase64 || derBase64.length > 16 * 1024) {
    return NextResponse.json({ ok: false, error: "certificate_missing" }, { status: 422 });
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(Buffer.from(derBase64, "base64"));
  } catch {
    return NextResponse.json({ ok: false, error: "certificate_invalid" }, { status: 422 });
  }
  const forwardedFingerprint = (request.headers.get("x-dpf-edge-cert-fingerprint") ?? "")
    .replaceAll(":", "")
    .toLowerCase();
  const parsedFingerprint = certificate.fingerprint256.replaceAll(":", "").toLowerCase();
  if (!forwardedFingerprint || forwardedFingerprint !== parsedFingerprint) {
    return NextResponse.json({ ok: false, error: "certificate_metadata_mismatch" }, { status: 422 });
  }

  const result = await registerEdgeNodeCertificate(prisma as unknown as EdgeCertificateRegistrationDb, {
    edgeNodeRowId: authz.edgeNodeRowId,
    certificateId: `edgecert_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    metadata: {
      fingerprintSha256: parsedFingerprint,
      serialNumber: certificate.serialNumber,
      subject: certificate.subject,
      issuer: certificate.issuer,
      clientAuth: certificate.keyUsage?.includes(CLIENT_AUTH_OID) ?? false,
      validFrom: new Date(certificate.validFrom),
      validUntil: new Date(certificate.validTo),
    },
  });
  if (!result.ok) {
    const status = result.error === "certificate_already_bound" ? 409 : 422;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, certificateId: result.certificateId, created: result.created }, { status: result.created ? 201 : 200 });
}
