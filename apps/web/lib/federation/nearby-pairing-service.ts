import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import {
  isFederationPairingStatus,
  resolveFederationPairingStatus,
} from "@dpf/db/federation-pairing-types";

import {
  assertEncryptionReadyForCredentialWrite,
  decryptSecret as decryptStoredSecret,
  encryptSecret as encryptStoredSecret,
} from "@/lib/govern/credential-crypto";

import {
  createNearbyPairingMaterial,
  pairingSecretMatches,
  parseNearbyPairingRequest,
  summarizeNearbyPairingProjection,
  type NearbyPairingRequest,
} from "./nearby-pairing";
import { generateFederationBootstrapToken } from "./tokens";

const PAIRING_TTL_MS = 15 * 60_000;

interface SessionCreateDb {
  federationPairingSession: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface ApprovalSessionRow {
  id: string;
  pairingId: string;
  direction: string;
  status: string;
  expiresAt: Date;
}

interface ApprovalTx {
  federationPairingSession: {
    findUnique(args: unknown): Promise<ApprovalSessionRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<unknown>;
  };
  federationBootstrapToken: {
    create(args: unknown): Promise<{ id: string }>;
  };
}

interface ApprovalDb {
  $transaction<T>(callback: (tx: ApprovalTx) => Promise<T>): Promise<T>;
}

interface PollSessionRow {
  id: string;
  pairingId: string;
  direction: string;
  status: string;
  pairingSecretHash: string | null;
  bootstrapTokenEnc: string | null;
  matchingCode: string;
  expiresAt: Date;
  deliveredAt?: Date | null;
  bootstrapToken: {
    consumedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  } | null;
}

interface PollDb {
  federationPairingSession: {
    findUnique(args: unknown): Promise<PollSessionRow | null>;
    update(args: unknown): Promise<unknown>;
  };
}

interface DenyDb {
  federationPairingSession: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export async function createIncomingNearbyPairing(
  input: unknown,
  options: {
    db?: SessionCreateDb;
    now?: Date;
    pairingId?: string;
    randomBytes?: (size: number) => Buffer;
    localDisplayName: string;
    localInstallationId: string;
  },
) {
  const request = parseNearbyPairingRequest(input);
  const now = options.now ?? new Date();
  const pairingId = options.pairingId ?? `pair_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const material = createNearbyPairingMaterial(
    options.randomBytes ? { randomBytes: options.randomBytes } : {},
  );
  await (options.db ?? (prisma as unknown as SessionCreateDb)).federationPairingSession.create({
    data: {
      pairingId,
      direction: "incoming",
      status: "pending",
      relationshipPreset: "same-organization",
      projectionTemplateKey: "same-organization",
      matchingCode: material.matchingCode,
      pairingSecretHash: material.secretHash,
      peerAuthorityUrl: request.requesterAuthorityUrl,
      peerDisplayName: request.displayName,
      peerInstallationId: request.requesterInstallationId,
      candidateDiscoveryId: request.candidateDiscoveryId,
      requestedAt: now,
      expiresAt,
    },
  });
  return {
    ok: true as const,
    pairingId,
    pairingSecret: material.plaintextSecret,
    matchingCode: material.matchingCode,
    peerDisplayName: options.localDisplayName,
    peerInstallationId: options.localInstallationId,
    expiresAt: expiresAt.toISOString(),
    projectionSummary: summarizeNearbyPairingProjection(),
  };
}

export type ApproveIncomingPairingResult =
  | { ok: true; status: "approved" }
  | { ok: false; error: "not_found" | "expired" | "invalid_transition" };

export async function approveIncomingNearbyPairing(
  input: { pairingId: string; approverPrincipalId: string },
  options: {
    db?: ApprovalDb;
    now?: Date;
    encryptSecret?: (value: string) => string;
    bootstrapMaterial?: { plaintext: string; hash: string; prefix: string };
  } = {},
): Promise<ApproveIncomingPairingResult> {
  await assertEncryptionReadyForCredentialWrite();
  const db = options.db ?? (prisma as unknown as ApprovalDb);
  const now = options.now ?? new Date();
  const encryptSecret = options.encryptSecret ?? encryptStoredSecret;
  return db.$transaction(async (tx) => {
    const row = await tx.federationPairingSession.findUnique({
      where: { pairingId: input.pairingId },
    });
    if (!row || row.direction !== "incoming" || !isFederationPairingStatus(row.status)) {
      return { ok: false, error: "not_found" };
    }
    const effectiveStatus = resolveFederationPairingStatus({
      status: row.status,
      expiresAt: row.expiresAt,
      now,
    });
    if (effectiveStatus === "expired") {
      await tx.federationPairingSession.update({
        where: { id: row.id },
        data: { status: "expired", pairingSecretEnc: null, bootstrapTokenEnc: null },
      });
      return { ok: false, error: "expired" };
    }
    if (effectiveStatus !== "pending") {
      return { ok: false, error: "invalid_transition" };
    }
    const claimed = await tx.federationPairingSession.updateMany({
      where: { id: row.id, status: "pending", expiresAt: { gt: now } },
      data: { status: "approved", approvedAt: now, approvedByPrincipalId: input.approverPrincipalId },
    });
    if (claimed.count !== 1) return { ok: false, error: "invalid_transition" };

    const bootstrap = options.bootstrapMaterial ?? generateFederationBootstrapToken();
    const token = await tx.federationBootstrapToken.create({
      data: {
        tokenHash: bootstrap.hash,
        prefix: bootstrap.prefix,
        offeredRole: "same-org-peer",
        proposedProjection: DEMAND_PROJECTION_TEMPLATES["same-organization"],
        issuedByPrincipalId: input.approverPrincipalId,
        expiresAt: row.expiresAt,
      },
    });
    await tx.federationPairingSession.update({
      where: { id: row.id },
      data: {
        status: "approved",
        bootstrapTokenId: token.id,
        bootstrapTokenEnc: encryptSecret(bootstrap.plaintext),
      },
    });
    return { ok: true, status: "approved" };
  });
}

export type PollIncomingPairingResult =
  | { ok: true; status: "pending" | "denied" | "expired" | "consumed" }
  | { ok: true; status: "approved"; bootstrapToken: string }
  | { ok: false; error: "not_found" | "credential_unavailable" };

export async function pollIncomingNearbyPairing(
  input: { pairingId: string; pairingSecret: string },
  options: {
    db?: PollDb;
    now?: Date;
    decryptSecret?: (value: string) => string | null;
  } = {},
): Promise<PollIncomingPairingResult> {
  const db = options.db ?? (prisma as unknown as PollDb);
  const now = options.now ?? new Date();
  const row = await db.federationPairingSession.findUnique({
    where: { pairingId: input.pairingId },
    include: { bootstrapToken: true },
  });
  if (
    !row ||
    row.direction !== "incoming" ||
    !row.pairingSecretHash ||
    !pairingSecretMatches(input.pairingSecret, row.pairingSecretHash) ||
    !isFederationPairingStatus(row.status)
  ) {
    return { ok: false, error: "not_found" };
  }
  const status = resolveFederationPairingStatus({ status: row.status, expiresAt: row.expiresAt, now });
  if (status === "expired") {
    await db.federationPairingSession.update({
      where: { id: row.id },
      data: {
        status: "expired",
        pairingSecretEnc: null,
        bootstrapTokenEnc: null,
        lastPolledAt: now,
        pollCount: { increment: 1 },
      },
    });
    return { ok: true, status: "expired" };
  }
  if (status === "pending" || status === "denied" || status === "consumed") {
    await db.federationPairingSession.update({
      where: { id: row.id },
      data: { lastPolledAt: now, pollCount: { increment: 1 } },
    });
    return { ok: true, status };
  }
  if (
    !row.bootstrapToken ||
    row.bootstrapToken.consumedAt ||
    row.bootstrapToken.revokedAt ||
    row.bootstrapToken.expiresAt.getTime() <= now.getTime()
  ) {
    await db.federationPairingSession.update({
      where: { id: row.id },
      data: {
        status: "consumed",
        consumedAt: now,
        pairingSecretEnc: null,
        bootstrapTokenEnc: null,
        lastPolledAt: now,
        pollCount: { increment: 1 },
      },
    });
    return { ok: true, status: "consumed" };
  }
  if (!row.bootstrapTokenEnc) return { ok: false, error: "credential_unavailable" };
  const bootstrapToken = (options.decryptSecret ?? decryptStoredSecret)(row.bootstrapTokenEnc);
  if (!bootstrapToken) return { ok: false, error: "credential_unavailable" };
  await db.federationPairingSession.update({
    where: { id: row.id },
    data: {
      deliveredAt: row.deliveredAt ?? now,
      lastPolledAt: now,
      pollCount: { increment: 1 },
    },
  });
  return { ok: true, status: "approved", bootstrapToken };
}

export async function denyIncomingNearbyPairing(
  input: { pairingId: string; deniedByPrincipalId: string; reason: string },
  options: { db?: DenyDb; now?: Date } = {},
): Promise<
  | { ok: true; status: "denied" }
  | { ok: false; error: "invalid_input" | "invalid_transition" }
> {
  const reason = input.reason.trim();
  if (!input.pairingId.trim() || !input.deniedByPrincipalId.trim() || !reason || reason.length > 500) {
    return { ok: false, error: "invalid_input" };
  }
  const now = options.now ?? new Date();
  const result = await (
    options.db ?? (prisma as unknown as DenyDb)
  ).federationPairingSession.updateMany({
    where: {
      pairingId: input.pairingId,
      direction: "incoming",
      status: "pending",
      expiresAt: { gt: now },
    },
    data: {
      status: "denied",
      deniedAt: now,
      deniedByPrincipalId: input.deniedByPrincipalId,
      denialReason: reason,
      pairingSecretEnc: null,
      bootstrapTokenEnc: null,
    },
  });
  return result.count === 1
    ? { ok: true, status: "denied" }
    : { ok: false, error: "invalid_transition" };
}

export type { NearbyPairingRequest };
