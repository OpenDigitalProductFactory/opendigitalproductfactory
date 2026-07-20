import { createHmac, randomBytes, randomUUID } from "node:crypto";

const FEDERATION_IDENTITY_KEY = "federation.identity";

export interface FederationIdentity {
  installationId: string;
  projectionSecret: string;
}

export interface FederationIdentityDb {
  platformConfig: {
    upsert(args: unknown): Promise<{ value: unknown }>;
  };
}

function decodeIdentity(value: unknown): FederationIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<FederationIdentity>;
  if (!/^inst_[a-f0-9]{32}$/.test(candidate.installationId ?? "")) return null;
  if (!/^[a-f0-9]{64}$/.test(candidate.projectionSecret ?? "")) return null;
  return candidate as FederationIdentity;
}

function generateIdentity(): FederationIdentity {
  return {
    installationId: `inst_${randomUUID().replaceAll("-", "")}`,
    projectionSecret: randomBytes(32).toString("hex"),
  };
}

/** Resolve stable, local-only identity material without relying on hostnames. */
export async function resolveFederationIdentity(db: FederationIdentityDb): Promise<FederationIdentity> {
  const generated = generateIdentity();
  const row = await db.platformConfig.upsert({
    where: { key: FEDERATION_IDENTITY_KEY },
    create: { key: FEDERATION_IDENTITY_KEY, value: generated },
    update: {},
    select: { value: true },
  });
  const identity = decodeIdentity(row.value);
  if (!identity) throw new Error("Stored federation identity is invalid and requires operator repair.");
  return identity;
}

function opaqueRef(secret: string, purpose: string, localRecordRef: string): string {
  return createHmac("sha256", secret)
    .update(`${purpose}\u0000${localRecordRef}`)
    .digest("hex")
    .slice(0, 32);
}

/** Stable cross-link references that cannot be reversed to a local BI identifier. */
export function deriveDemandNetworkRefs(
  identity: FederationIdentity,
  localRecordRef: string,
): { envelopeId: string; originRecordRef: string } {
  return {
    envelopeId: `dem_${opaqueRef(identity.projectionSecret, "envelope", localRecordRef)}`,
    originRecordRef: `ref_${opaqueRef(identity.projectionSecret, "origin", localRecordRef)}`,
  };
}
