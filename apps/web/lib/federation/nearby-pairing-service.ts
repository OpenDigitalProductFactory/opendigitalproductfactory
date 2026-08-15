import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import {
  isFederationRelationshipPreset,
  isFederationRole,
  isRoleAllowedForRelationship,
} from "@dpf/db/federation-link-types";
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
import type { FederationSigningIdentity } from "./demand-identity";
import { signIdentityStatement } from "./instance-identity";
import {
  buildSasCommitmentStatement,
  computeCommitment,
  deriveSas,
  deriveSharedSecret,
  generateEphemeralKeypair,
  generatePairingNonce,
  verifyCommitment,
} from "./sas-pairing";
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
  matchingCode: string;
  pairingSecretHash?: string | null;
  sasConfirmedAtLocal?: Date | null;
  sasConfirmedAtPeer?: Date | null;
  approvedByPrincipalId?: string | null;
  relationshipPreset: string;
  offeredRole: string;
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

interface SasSessionState {
  protocolVersion: 1;
  localDeviceId: string;
  localSigningPublicKey: string;
  localAuthorityUrl: string;
  localEphemeralPublicKey: string;
  localEphemeralPrivateKeyEnc: string | null;
  localNonceEnc: string | null;
  localNonce?: string;
  localCommitment: string;
  remoteDeviceId: string;
  remoteSigningPublicKey: string;
  remoteAuthorityUrl: string;
  remoteCommitment: string;
  remoteEphemeralPublicKey?: string;
  remoteNonce?: string;
}

interface RevealSessionRow {
  id: string;
  direction: string;
  status: string;
  pairingSecretHash: string | null;
  matchingCode: string;
  sasState: unknown;
  expiresAt: Date;
}

interface RevealDb {
  federationPairingSession: {
    findUnique(args: unknown): Promise<RevealSessionRow | null>;
    update(args: unknown): Promise<unknown>;
  };
}

function parseSasState(value: unknown): SasSessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Partial<SasSessionState>;
  if (
    state.protocolVersion !== 1 ||
    typeof state.localDeviceId !== "string" ||
    typeof state.localSigningPublicKey !== "string" ||
    typeof state.localAuthorityUrl !== "string" ||
    typeof state.localEphemeralPublicKey !== "string" ||
    typeof state.localCommitment !== "string" ||
    typeof state.remoteDeviceId !== "string" ||
    typeof state.remoteSigningPublicKey !== "string" ||
    typeof state.remoteAuthorityUrl !== "string" ||
    typeof state.remoteCommitment !== "string"
  ) return null;
  return state as SasSessionState;
}

function pairingPolicy(row: Pick<ApprovalSessionRow, "relationshipPreset" | "offeredRole">) {
  if (
    !isFederationRelationshipPreset(row.relationshipPreset) ||
    !isFederationRole(row.offeredRole) ||
    !isRoleAllowedForRelationship(row.relationshipPreset, row.offeredRole)
  ) return null;
  return {
    offeredRole: row.offeredRole,
    projection: DEMAND_PROJECTION_TEMPLATES[row.relationshipPreset],
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
    localAuthorityUrl: string;
    localSigningIdentity: FederationSigningIdentity;
    encryptSecret?: (value: string) => string;
  },
) {
  await assertEncryptionReadyForCredentialWrite();
  const request = parseNearbyPairingRequest(input);
  const now = options.now ?? new Date();
  const pairingId = options.pairingId ?? `pair_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const material = createNearbyPairingMaterial(
    options.randomBytes ? { randomBytes: options.randomBytes } : {},
  );
  const encryptSecret = options.encryptSecret ?? encryptStoredSecret;
  const localEphemeral = generateEphemeralKeypair();
  const localNonce = generatePairingNonce();
  const localCommitment = computeCommitment(localEphemeral.publicKey, localNonce);
  const commitmentStatement = buildSasCommitmentStatement({
    deviceId: options.localSigningIdentity.deviceId,
    peerBinding: request.requesterDeviceId,
    authorityUrl: new URL(options.localAuthorityUrl).origin,
    pairingContext: pairingId,
    commitment: localCommitment,
  });
  const receiverCommitmentSignature = signIdentityStatement(
    options.localSigningIdentity.signingPrivateKey,
    commitmentStatement,
  );
  await (options.db ?? (prisma as unknown as SessionCreateDb)).federationPairingSession.create({
    data: {
      pairingId,
      direction: "incoming",
      status: "pending",
      relationshipPreset: request.relationshipPreset,
      projectionTemplateKey: request.relationshipPreset,
      offeredRole: request.offeredRole,
      matchingCode: "",
      sasState: {
        protocolVersion: 1,
        localDeviceId: options.localSigningIdentity.deviceId,
        localSigningPublicKey: options.localSigningIdentity.signingPublicKey,
        localAuthorityUrl: new URL(options.localAuthorityUrl).origin,
        localEphemeralPublicKey: localEphemeral.publicKey,
        localEphemeralPrivateKeyEnc: encryptSecret(localEphemeral.privateKey),
        localNonceEnc: encryptSecret(localNonce),
        localCommitment,
        remoteDeviceId: request.requesterDeviceId,
        remoteSigningPublicKey: request.requesterSigningPublicKey,
        remoteAuthorityUrl: request.requesterAuthorityUrl,
        remoteCommitment: request.requesterCommitment,
      },
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
    receiverDeviceId: options.localSigningIdentity.deviceId,
    receiverSigningPublicKey: options.localSigningIdentity.signingPublicKey,
    receiverCommitment: localCommitment,
    receiverCommitmentSignature,
    peerDisplayName: options.localDisplayName,
    peerInstallationId: options.localInstallationId,
    expiresAt: expiresAt.toISOString(),
    projectionSummary: summarizeNearbyPairingProjection(request.relationshipPreset),
  };
}

export type RevealIncomingPairingResult =
  | {
      ok: true;
      matchingCode: string;
      receiverEphemeralPublicKey: string;
      receiverNonce: string;
    }
  | { ok: false; error: "not_found" | "expired" | "invalid_transition" | "commitment_mismatch" | "credential_unavailable" };

export async function revealIncomingNearbyPairing(
  input: {
    pairingId: string;
    pairingSecret: string;
    requesterEphemeralPublicKey: string;
    requesterNonce: string;
  },
  options: {
    db?: RevealDb;
    now?: Date;
    decryptSecret?: (value: string) => string | null;
  } = {},
): Promise<RevealIncomingPairingResult> {
  const db = options.db ?? (prisma as unknown as RevealDb);
  const now = options.now ?? new Date();
  const row = await db.federationPairingSession.findUnique({ where: { pairingId: input.pairingId } });
  if (
    !row ||
    row.direction !== "incoming" ||
    !row.pairingSecretHash ||
    !pairingSecretMatches(input.pairingSecret, row.pairingSecretHash)
  ) return { ok: false, error: "not_found" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.federationPairingSession.update({
      where: { id: row.id },
      data: { status: "expired", pairingSecretEnc: null, bootstrapTokenEnc: null },
    });
    return { ok: false, error: "expired" };
  }
  if (row.status !== "pending") return { ok: false, error: "invalid_transition" };
  const state = parseSasState(row.sasState);
  if (!state) return { ok: false, error: "invalid_transition" };
  if (
    state.remoteEphemeralPublicKey === input.requesterEphemeralPublicKey &&
    state.remoteNonce === input.requesterNonce &&
    state.localNonce &&
    /^\d{6}$/.test(row.matchingCode)
  ) {
    return {
      ok: true,
      matchingCode: row.matchingCode,
      receiverEphemeralPublicKey: state.localEphemeralPublicKey,
      receiverNonce: state.localNonce,
    };
  }
  if (!verifyCommitment(
    input.requesterEphemeralPublicKey,
    input.requesterNonce,
    state.remoteCommitment,
  )) return { ok: false, error: "commitment_mismatch" };
  if (!state.localEphemeralPrivateKeyEnc || !state.localNonceEnc) {
    return { ok: false, error: "credential_unavailable" };
  }
  const decrypt = options.decryptSecret ?? decryptStoredSecret;
  const localPrivateKey = decrypt(state.localEphemeralPrivateKeyEnc);
  const localNonce = decrypt(state.localNonceEnc);
  if (!localPrivateKey || !localNonce) return { ok: false, error: "credential_unavailable" };
  const matchingCode = deriveSas({
    localDeviceId: state.localDeviceId,
    remoteDeviceId: state.remoteDeviceId,
    localEphemeralPublicKey: state.localEphemeralPublicKey,
    remoteEphemeralPublicKey: input.requesterEphemeralPublicKey,
    localNonce,
    remoteNonce: input.requesterNonce,
    sharedSecret: deriveSharedSecret(localPrivateKey, input.requesterEphemeralPublicKey),
  });
  const revealedState: SasSessionState = {
    ...state,
    localEphemeralPrivateKeyEnc: null,
    localNonceEnc: null,
    localNonce,
    remoteEphemeralPublicKey: input.requesterEphemeralPublicKey,
    remoteNonce: input.requesterNonce,
  };
  await db.federationPairingSession.update({
    where: { id: row.id },
    data: { matchingCode, sasState: revealedState },
  });
  return {
    ok: true,
    matchingCode,
    receiverEphemeralPublicKey: state.localEphemeralPublicKey,
    receiverNonce: localNonce,
  };
}

export type ApproveIncomingPairingResult =
  | { ok: true; status: "approved" }
  | { ok: true; status: "pending-confirmation" }
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
    if (effectiveStatus !== "pending" || !/^\d{6}$/.test(row.matchingCode)) {
      return { ok: false, error: "invalid_transition" };
    }
    const policy = pairingPolicy(row);
    if (!policy) return { ok: false, error: "invalid_transition" };
    const claimed = await tx.federationPairingSession.updateMany({
      where: { id: row.id, status: "pending", expiresAt: { gt: now } },
      data: {
        approvedAt: now,
        approvedByPrincipalId: input.approverPrincipalId,
        sasConfirmedAtLocal: now,
      },
    });
    if (claimed.count !== 1) return { ok: false, error: "invalid_transition" };
    if (!row.sasConfirmedAtPeer) return { ok: true, status: "pending-confirmation" };

    const finalized = await tx.federationPairingSession.updateMany({
      where: {
        id: row.id,
        status: "pending",
        sasConfirmedAtPeer: { not: null },
      },
      data: { status: "approved" },
    });
    if (finalized.count !== 1) return { ok: false, error: "invalid_transition" };

    const bootstrap = options.bootstrapMaterial ?? generateFederationBootstrapToken();
    const token = await tx.federationBootstrapToken.create({
      data: {
        tokenHash: bootstrap.hash,
        prefix: bootstrap.prefix,
        offeredRole: policy.offeredRole,
        proposedProjection: policy.projection,
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

export type ConfirmIncomingPairingResult =
  | { ok: true; status: "pending-confirmation" | "approved" }
  | { ok: false; error: "not_found" | "expired" | "invalid_transition" };

export async function confirmIncomingNearbyPairing(
  input: { pairingId: string; pairingSecret: string },
  options: {
    db?: ApprovalDb;
    now?: Date;
    encryptSecret?: (value: string) => string;
    bootstrapMaterial?: { plaintext: string; hash: string; prefix: string };
  } = {},
): Promise<ConfirmIncomingPairingResult> {
  await assertEncryptionReadyForCredentialWrite();
  const db = options.db ?? (prisma as unknown as ApprovalDb);
  const now = options.now ?? new Date();
  const encryptSecret = options.encryptSecret ?? encryptStoredSecret;
  return db.$transaction(async (tx) => {
    const row = await tx.federationPairingSession.findUnique({ where: { pairingId: input.pairingId } });
    if (
      !row ||
      row.direction !== "incoming" ||
      !isFederationPairingStatus(row.status) ||
      !row.pairingSecretHash ||
      !pairingSecretMatches(input.pairingSecret, row.pairingSecretHash)
    ) return { ok: false, error: "not_found" };
    const effectiveStatus = resolveFederationPairingStatus({ status: row.status, expiresAt: row.expiresAt, now });
    if (effectiveStatus === "expired") {
      await tx.federationPairingSession.update({
        where: { id: row.id },
        data: { status: "expired", pairingSecretEnc: null, bootstrapTokenEnc: null },
      });
      return { ok: false, error: "expired" };
    }
    if (effectiveStatus !== "pending" || !/^\d{6}$/.test(row.matchingCode)) {
      return { ok: false, error: "invalid_transition" };
    }
    const policy = pairingPolicy(row);
    if (!policy) return { ok: false, error: "invalid_transition" };
    const confirmed = await tx.federationPairingSession.updateMany({
      where: { id: row.id, status: "pending", expiresAt: { gt: now } },
      data: { sasConfirmedAtPeer: now },
    });
    if (confirmed.count !== 1) return { ok: false, error: "invalid_transition" };
    if (!row.sasConfirmedAtLocal || !row.approvedByPrincipalId) {
      return { ok: true, status: "pending-confirmation" };
    }
    const finalized = await tx.federationPairingSession.updateMany({
      where: {
        id: row.id,
        status: "pending",
        sasConfirmedAtLocal: { not: null },
      },
      data: { status: "approved" },
    });
    if (finalized.count !== 1) return { ok: false, error: "invalid_transition" };
    const bootstrap = options.bootstrapMaterial ?? generateFederationBootstrapToken();
    const token = await tx.federationBootstrapToken.create({
      data: {
        tokenHash: bootstrap.hash,
        prefix: bootstrap.prefix,
        offeredRole: policy.offeredRole,
        proposedProjection: policy.projection,
        issuedByPrincipalId: row.approvedByPrincipalId,
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
