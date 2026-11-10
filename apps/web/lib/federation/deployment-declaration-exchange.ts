// Deployment country declaration (BI-06EA3167, design
// docs/superpowers/specs/2026-10-01-deployment-country-declaration-design.md).
//
// Sending side: an opted-in install queues one local-canonical outbox row per
// upward link (where this install is managed-by or channel-downstream), drained
// by the shared federation delivery queue exactly like a posture report.
// Receiving side: the organization above mirrors it peer-canonically, and a
// withdrawal marks the mirror withdrawn. Pure apart from the injected db.

import { createHash } from "node:crypto";

import {
  computeDeploymentDeclarationDigest,
  DEPLOYMENT_DECLARATION_ACTIVITIES,
  DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE,
  DEPLOYMENT_DECLARATION_RECORD_TYPE,
  validateDeploymentDeclarationV1,
  type DeploymentDeclarationActivity,
  type DeploymentDeclarationV1,
} from "@dpf/db/federated-deployment-declaration-contract";
import { assertNoExcludedEgress, projectEstatePayload } from "@dpf/db/projection-serialization";

import type { DemandDeliveryDb, DemandLinkTarget } from "./demand-delivery";
import type { FederationIdentity } from "./demand-identity";
import { scheduleFederationDeliveryJob } from "./delivery-queue";

/** PlatformConfig key holding the operator's choice; a missing row means off. */
export const DEPLOYMENT_COUNTRY_SHARE_KEY = "federation.deploymentCountry.share";

/** This install's role on links it declares over: the organization above it. */
export const DECLARING_LINK_ROLES = ["managed-by", "channel-downstream"] as const;
/** The receiver's role on links it accepts declarations from. */
export const RECEIVING_LINK_ROLES = ["manages", "channel-upstream"] as const;

const ACTIVITY: DeploymentDeclarationActivity = "dpf.deployment-declaration.reported";

export function buildDeploymentDeclaration(input: {
  identity: Pick<FederationIdentity, "installationId">;
  state: "declared" | "withdrawn";
  countryCode: string | null;
  now: Date;
}): { record: DeploymentDeclarationV1; violations: string[] } {
  const candidate: DeploymentDeclarationV1 = {
    specVersion: "dpf.deployment-declaration/1",
    originInstallationId: input.identity.installationId,
    originVersion: Math.max(1, input.now.getTime()),
    state: input.state,
    countryCode: input.state === "declared" ? input.countryCode : null,
    declaredAt: input.now.toISOString(),
    payloadDigest: "sha256:pending",
  };
  candidate.payloadDigest = computeDeploymentDeclarationDigest(candidate);
  const projection = projectEstatePayload(DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE, { declaration: candidate });
  const record = projection.projected.declaration as DeploymentDeclarationV1;
  return {
    record,
    violations: [
      ...assertNoExcludedEgress(DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE, projection.projected),
      ...validateDeploymentDeclarationV1(record),
    ],
  };
}

// ─── Sending side: the outbox ────────────────────────────────────────────────

export interface DeploymentDeclarationOutboxPayload {
  record: DeploymentDeclarationV1;
  activity: DeploymentDeclarationActivity;
  eventId: string;
  queuedAt: string;
}

export function deploymentDeclarationRef(installationId: string): string {
  return `deployment:${installationId}`;
}

export function decodeDeploymentDeclarationOutboxPayload(value: unknown): DeploymentDeclarationOutboxPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<DeploymentDeclarationOutboxPayload>;
  if (!payload.record || typeof payload.record !== "object" || typeof payload.eventId !== "string") return null;
  if (!(DEPLOYMENT_DECLARATION_ACTIVITIES as readonly string[]).includes(payload.activity ?? "")) return null;
  return payload as DeploymentDeclarationOutboxPayload;
}

function hashId(prefix: string, parts: string): string {
  return `${prefix}_${createHash("sha256").update(parts).digest("hex").slice(0, 24)}`;
}

export async function queueDeploymentDeclaration(
  db: DemandDeliveryDb,
  input: {
    link: DemandLinkTarget;
    record: DeploymentDeclarationV1;
    now?: Date;
    schedule?: (db: DemandDeliveryDb, mirrorId: string, now: Date) => Promise<unknown>;
  },
): Promise<{ action: "queued"; mirrorId: string; originVersion: number }> {
  const now = input.now ?? new Date();
  const schedule = input.schedule ?? scheduleFederationDeliveryJob;
  const localRecordRef = deploymentDeclarationRef(input.record.originInstallationId);
  const where = {
    federationLinkId_recordType_localRecordRef: {
      federationLinkId: input.link.linkId,
      recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
      localRecordRef,
    },
  };
  const existing = await db.federatedRecordMirror.findUnique({ where });
  const record = { ...input.record };
  // A later change must always out-version the last one sent on this link.
  if (existing && record.originVersion <= Number(existing.version)) {
    record.originVersion = Number(existing.version) + 1;
    record.payloadDigest = computeDeploymentDeclarationDigest(record);
  }
  const payload: DeploymentDeclarationOutboxPayload = {
    record,
    activity: ACTIVITY,
    eventId: hashId("fdde", `${input.link.linkId} ${record.originInstallationId} ${record.originVersion}`),
    queuedAt: now.toISOString(),
  };
  const data = { syncStatus: "pending", version: record.originVersion, payload, deadLetteredAt: null };
  if (existing) {
    await db.federatedRecordMirror.update({ where: { mirrorId: existing.mirrorId }, data });
    await schedule(db, existing.mirrorId, now);
    return { action: "queued", mirrorId: existing.mirrorId, originVersion: record.originVersion };
  }
  const mirrorId = hashId("fddo", `${input.link.linkId} ${localRecordRef}`);
  await db.federatedRecordMirror.create({
    data: {
      mirrorId,
      federationLinkId: input.link.linkId,
      recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
      canonicalSide: "local",
      localRecordRef,
      peerRecordRef: null,
      ...data,
    },
  });
  await schedule(db, mirrorId, now);
  return { action: "queued", mirrorId, originVersion: record.originVersion };
}

// ─── Receiving side: the mirror ──────────────────────────────────────────────

export interface DeploymentDeclarationExchangeDb {
  federatedRecordMirror: {
    findUnique(args: unknown): Promise<{ mirrorId: string; version: bigint; syncStatus: string; payload: unknown } | null>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export type IncomingDeploymentDeclarationResult =
  | { action: "created" | "updated" | "noop"; mirrorId: string; originVersion: number }
  | { action: "conflict"; mirrorId: string; originVersion: number; reason: "origin-version-not-advancing" | "concurrent-update" }
  | { action: "rejected"; violations: string[] };

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function handleIncomingDeploymentDeclaration(
  db: DeploymentDeclarationExchangeDb,
  linkId: string,
  record: DeploymentDeclarationV1,
  options: { now?: Date } = {},
): Promise<IncomingDeploymentDeclarationResult> {
  const violations = validateDeploymentDeclarationV1(record);
  if (violations.length > 0) return { action: "rejected", violations };

  const peerRef = deploymentDeclarationRef(record.originInstallationId);
  const where = {
    federationLinkId_recordType_peerRecordRef: {
      federationLinkId: linkId,
      recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
      peerRecordRef: peerRef,
    },
  };
  const receivedAt = options.now ?? new Date();
  const syncStatus = record.state === "withdrawn" ? "withdrawn" : "synced";
  const payload = { record, activity: ACTIVITY, receivedAt: receivedAt.toISOString() };

  let existing = await db.federatedRecordMirror.findUnique({ where });
  if (!existing) {
    const mirrorId = hashId("fddm", `${linkId} ${peerRef}`);
    try {
      await db.federatedRecordMirror.create({
        data: {
          mirrorId,
          federationLinkId: linkId,
          recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
          canonicalSide: "peer",
          localRecordRef: null,
          peerRecordRef: peerRef,
          syncStatus,
          version: record.originVersion,
          payload,
          lastSyncedAt: receivedAt,
        },
      });
      return { action: "created", mirrorId, originVersion: record.originVersion };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      existing = await db.federatedRecordMirror.findUnique({ where });
      if (!existing) throw error;
    }
  }

  const current = (existing.payload as { record?: DeploymentDeclarationV1 } | null)?.record;
  if (Number(existing.version) === record.originVersion && current?.payloadDigest === record.payloadDigest) {
    return { action: "noop", mirrorId: existing.mirrorId, originVersion: record.originVersion };
  }
  if (record.originVersion <= Number(existing.version)) {
    return { action: "conflict", mirrorId: existing.mirrorId, originVersion: Number(existing.version), reason: "origin-version-not-advancing" };
  }
  const advanced = await db.federatedRecordMirror.updateMany({
    where: {
      federationLinkId: linkId,
      recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
      peerRecordRef: peerRef,
      version: { lt: record.originVersion },
    },
    data: { syncStatus, version: record.originVersion, payload, conflictReason: null, lastSyncedAt: receivedAt },
  });
  if (advanced.count !== 1) {
    return { action: "conflict", mirrorId: existing.mirrorId, originVersion: Number(existing.version), reason: "concurrent-update" };
  }
  return { action: "updated", mirrorId: existing.mirrorId, originVersion: record.originVersion };
}

/** Countries of installs that currently declare one to this install, one per install. */
export function declaredDeploymentRows(
  mirrors: ReadonlyArray<{ syncStatus: string; payload: unknown }>,
): Array<{ siteId: string; country: string }> {
  const byInstall = new Map<string, string>();
  for (const mirror of mirrors) {
    if (mirror.syncStatus !== "synced") continue;
    const record = (mirror.payload as { record?: DeploymentDeclarationV1 } | null)?.record;
    if (record?.state !== "declared" || !record.countryCode) continue;
    byInstall.set(record.originInstallationId, record.countryCode);
  }
  return [...byInstall].map(([siteId, country]) => ({ siteId: `install:${siteId}`, country }));
}
