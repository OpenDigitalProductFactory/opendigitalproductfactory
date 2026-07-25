export interface EdgeClientCertificateMetadata {
  fingerprintSha256: string;
  serialNumber: string;
  subject: string;
  issuer: string;
  clientAuth: boolean;
  validFrom: Date;
  validUntil: Date;
}

interface StoredCertificateBinding {
  id: string;
  edgeNodeId: string;
}

export interface EdgeCertificateRegistrationDb {
  $transaction<T>(operation: (tx: EdgeCertificateRegistrationTransaction) => Promise<T>): Promise<T>;
}

interface EdgeCertificateRegistrationTransaction {
  edgeNodeCertificate: {
    findUnique(args: unknown): Promise<StoredCertificateBinding | null>;
    create(args: unknown): Promise<{ id: string; certificateId: string }>;
    update(args: unknown): Promise<{ id: string; certificateId: string }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export type EdgeCertificateRegistrationResult =
  | { ok: true; certificateId: string; created: boolean }
  | {
      ok: false;
      error:
        | "invalid_certificate_metadata"
        | "client_auth_required"
        | "wrong_certificate_profile"
        | "certificate_not_yet_valid"
        | "certificate_expired"
        | "certificate_lifetime_too_long"
        | "certificate_already_bound";
    };

export async function registerEdgeNodeCertificate(
  db: EdgeCertificateRegistrationDb,
  input: {
    edgeNodeRowId: string;
    metadata: EdgeClientCertificateMetadata;
    certificateId: string;
    now?: Date;
  },
): Promise<EdgeCertificateRegistrationResult> {
  const { metadata } = input;
  const fingerprintSha256 = metadata.fingerprintSha256.replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprintSha256) || !metadata.serialNumber || !metadata.issuer) {
    return { ok: false, error: "invalid_certificate_metadata" };
  }
  if (!metadata.clientAuth) return { ok: false, error: "client_auth_required" };
  if (!/^CN=dpf-edge-[A-Za-z0-9._-]+$/.test(metadata.subject)) {
    return { ok: false, error: "wrong_certificate_profile" };
  }

  const now = input.now ?? new Date();
  if (metadata.validFrom.getTime() > now.getTime() + 30_000) {
    return { ok: false, error: "certificate_not_yet_valid" };
  }
  if (metadata.validUntil.getTime() <= now.getTime()) return { ok: false, error: "certificate_expired" };
  if (metadata.validUntil.getTime() - metadata.validFrom.getTime() > 32 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "certificate_lifetime_too_long" };
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.edgeNodeCertificate.findUnique({ where: { fingerprintSha256 } });
    if (existing && existing.edgeNodeId !== input.edgeNodeRowId) {
      return { ok: false, error: "certificate_already_bound" };
    }

    await tx.edgeNodeCertificate.updateMany({
      where: {
        edgeNodeId: input.edgeNodeRowId,
        status: "active",
        fingerprintSha256: { not: fingerprintSha256 },
      },
      data: {
        status: "superseded",
        revokedAt: now,
        revocationReason: "certificate_renewed",
      },
    });

    if (existing) {
      const updated = await tx.edgeNodeCertificate.update({
        where: { id: existing.id },
        data: { status: "active", revokedAt: null, revocationReason: null, lastSeenAt: now },
      });
      return { ok: true, certificateId: updated.certificateId, created: false };
    }

    const created = await tx.edgeNodeCertificate.create({
      data: {
        certificateId: input.certificateId,
        edgeNodeId: input.edgeNodeRowId,
        fingerprintSha256,
        serialNumber: metadata.serialNumber,
        subject: metadata.subject,
        issuer: metadata.issuer,
        provisioner: "dpf-edge-client",
        status: "active",
        validFrom: metadata.validFrom,
        validUntil: metadata.validUntil,
        registeredAt: now,
        lastSeenAt: now,
      },
    });
    return { ok: true, certificateId: created.certificateId, created: true };
  });
}
