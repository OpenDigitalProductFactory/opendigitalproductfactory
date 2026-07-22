import { timingSafeEqual } from "node:crypto";

export type EdgeNodeMtlsFailure = {
  ok: false;
  error:
    | "untrusted_proxy"
    | "certificate_missing"
    | "certificate_unknown"
    | "certificate_inactive"
    | "certificate_expired"
    | "certificate_not_yet_valid"
    | "certificate_node_mismatch"
    | "certificate_metadata_mismatch"
    | "node_revoked"
    | "node_not_trusted";
};

export type ResolvedEdgeNodeMtls = {
  ok: true;
  certificateId: string;
  fingerprintSha256: string;
};

interface EdgeNodeCertificateRow {
  id: string;
  edgeNodeId: string;
  fingerprintSha256: string;
  serialNumber: string;
  status: string;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
  edgeNode: { trustState: string; revokedAt: Date | null };
}

export interface EdgeNodeMtlsDb {
  edgeNodeCertificate: {
    findUnique(args: unknown): Promise<EdgeNodeCertificateRow | null>;
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isTrustedMtlsProxy(headers: Headers, proxySecret: string): boolean {
  const presented = headers.get("x-dpf-mtls-proxy-secret") ?? "";
  return proxySecret.length >= 32 && constantTimeEqual(presented, proxySecret);
}

function normalizeFingerprint(value: string | null): string | null {
  const normalized = value?.replaceAll(":", "").trim().toLowerCase() ?? "";
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeSerial(value: string): string {
  return value.replaceAll(":", "").trim().replace(/^0+(?=[a-fA-F0-9])/, "").toLowerCase();
}

export async function resolveEdgeNodeMtls(
  headers: Headers,
  bearerEdgeNodeRowId: string,
  db: EdgeNodeMtlsDb,
  options: { proxySecret: string; now?: Date },
): Promise<ResolvedEdgeNodeMtls | EdgeNodeMtlsFailure> {
  if (!isTrustedMtlsProxy(headers, options.proxySecret)) {
    return { ok: false, error: "untrusted_proxy" };
  }

  const fingerprintSha256 = normalizeFingerprint(headers.get("x-dpf-edge-cert-fingerprint"));
  const serialNumber = headers.get("x-dpf-edge-cert-serial")?.trim();
  if (!fingerprintSha256 || !serialNumber) return { ok: false, error: "certificate_missing" };

  const certificate = await db.edgeNodeCertificate.findUnique({
    where: { fingerprintSha256 },
    include: { edgeNode: { select: { trustState: true, revokedAt: true } } },
  });
  if (!certificate) return { ok: false, error: "certificate_unknown" };
  if (certificate.status !== "active" || certificate.revokedAt) return { ok: false, error: "certificate_inactive" };
  if (certificate.edgeNodeId !== bearerEdgeNodeRowId) return { ok: false, error: "certificate_node_mismatch" };
  if (normalizeSerial(certificate.serialNumber) !== normalizeSerial(serialNumber)) {
    return { ok: false, error: "certificate_metadata_mismatch" };
  }
  if (certificate.edgeNode.trustState === "revoked" || certificate.edgeNode.revokedAt) {
    return { ok: false, error: "node_revoked" };
  }
  if (certificate.edgeNode.trustState !== "trusted") {
    return { ok: false, error: "node_not_trusted" };
  }

  const now = options.now ?? new Date();
  if (certificate.validFrom.getTime() > now.getTime()) return { ok: false, error: "certificate_not_yet_valid" };
  if (certificate.validUntil.getTime() <= now.getTime()) return { ok: false, error: "certificate_expired" };
  return { ok: true, certificateId: certificate.id, fingerprintSha256 };
}
