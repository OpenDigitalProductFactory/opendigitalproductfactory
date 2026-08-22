import { createHash } from "node:crypto";

import type { PrismaClient } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export const EXTERNAL_CHANNEL_PROJECTION_STATES = [
  "reserved",
  "current",
  "drifted",
  "ambiguous",
  "detached",
] as const;
export type ExternalChannelProjectionState = (typeof EXTERNAL_CHANNEL_PROJECTION_STATES)[number];

export const EXTERNAL_CHANNEL_PROJECTION_SOURCE_TYPES = [
  "outbound_draft",
  "document",
  "knowledge_article",
  "product",
  "product_offering",
  "catalog_item",
  "storefront_section",
  "storefront_item",
  "marketing_asset",
] as const;
export type ExternalChannelProjectionSourceType = (typeof EXTERNAL_CHANNEL_PROJECTION_SOURCE_TYPES)[number];

export const EXTERNAL_CHANNEL_RESOURCE_KINDS = ["post", "page", "media"] as const;
export type ExternalChannelResourceKind = (typeof EXTERNAL_CHANNEL_RESOURCE_KINDS)[number];

type ProjectionMetadataScalar = string | number | boolean | null;
export type ExternalChannelProjectionMetadata = Record<string, ProjectionMetadataScalar>;

const MAX_METADATA_KEYS = 24;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_STRING_LENGTH = 256;
const MAX_METADATA_BYTES = 4_096;
const PROHIBITED_METADATA_KEY = /(authorization|cookie|credential|password|secret|token|username|body|content|html|payload|raw)/i;

export function sanitizeExternalChannelProjectionMetadata(input: unknown): ExternalChannelProjectionMetadata {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Projection metadata must be a bounded scalar object.");
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) throw new Error("Projection metadata exceeds its bounded key count.");
  const output: ExternalChannelProjectionMetadata = {};
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_METADATA_KEY_LENGTH) throw new Error("Projection metadata key is not bounded.");
    if (PROHIBITED_METADATA_KEY.test(key)) throw new Error(`Projection metadata key "${key}" is prohibited.`);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`Projection metadata "${key}" must be scalar.`);
    }
    if (typeof value === "string" && value.length > MAX_METADATA_STRING_LENGTH) {
      throw new Error(`Projection metadata "${key}" is not bounded.`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Projection metadata "${key}" must be finite.`);
    }
    output[key] = value as ProjectionMetadataScalar;
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_METADATA_BYTES) {
    throw new Error("Projection metadata exceeds its bounded byte size.");
  }
  return output;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Projection payload contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  throw new Error("Projection payload must be JSON-serializable.");
}

export function fingerprintExternalChannelPayload(payload: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

export interface ExternalChannelProjectionRow {
  externalChannelProjectionId: string;
  connectorKey: string;
  connectionId: string;
  credentialId: string | null;
  sourceType: ExternalChannelProjectionSourceType;
  sourceRef: string;
  sourceVersion: string;
  resourceKind: ExternalChannelResourceKind;
  locale: string;
  externalRef: string | null;
  externalUrl: string | null;
  localFingerprint: string;
  remoteFingerprint: string | null;
  remoteModifiedAt: Date | null;
  state: ExternalChannelProjectionState;
  metadata: unknown;
  reservedAt: Date;
  projectedAt: Date | null;
  observedAt: Date | null;
  driftedAt: Date | null;
  detachedAt: Date | null;
  lifecycle: "active" | "archived" | "retired" | "superseded" | "merged" | "quarantined";
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
}

type ProjectionStore = Pick<PrismaClient, "externalChannelProjection">;

type ProjectionResult = ActionResult<{ projection: ExternalChannelProjectionRow }>;
type ProjectionReservationResult = ActionResult<{
  mode: "reserved" | "existing";
  projection: ExternalChannelProjectionRow;
}>;

export interface ExternalChannelProjectionReservation {
  connectorKey: string;
  connectionId: string;
  credentialId?: string | null;
  sourceType: ExternalChannelProjectionSourceType;
  sourceId: string;
  sourceVersion: string;
  resourceKind: ExternalChannelResourceKind;
  locale?: string;
  localFingerprint: string;
  metadata?: unknown;
}

function normalizedIdentityPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`${label} is missing or not bounded.`);
  return normalized;
}

function normalizedSourceType(value: string): ExternalChannelProjectionSourceType {
  const normalized = normalizedIdentityPart(value, "sourceType");
  if (!EXTERNAL_CHANNEL_PROJECTION_SOURCE_TYPES.includes(normalized as ExternalChannelProjectionSourceType)) {
    throw new Error(`sourceType "${normalized}" is not supported.`);
  }
  return normalized as ExternalChannelProjectionSourceType;
}

function projectionIdentity(input: ExternalChannelProjectionReservation) {
  return {
    connectorKey: normalizedIdentityPart(input.connectorKey, "connectorKey"),
    connectionId: normalizedIdentityPart(input.connectionId, "connectionId"),
    sourceType: normalizedSourceType(input.sourceType),
    sourceRef: normalizedIdentityPart(input.sourceId, "sourceId"),
    resourceKind: input.resourceKind,
    locale: normalizedIdentityPart(input.locale ?? "und", "locale"),
  };
}

function projectionIdFor(identity: ReturnType<typeof projectionIdentity>): string {
  const material = [identity.connectorKey, identity.connectionId, identity.sourceType, identity.sourceRef, identity.resourceKind, identity.locale].join("\u001f");
  return `ecp-${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

function sourceIdentityWhere(identity: ReturnType<typeof projectionIdentity>) {
  return { connectorKey_connectionId_sourceType_sourceRef_resourceKind_locale: identity };
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

function storedMetadata(row: ExternalChannelProjectionRow): ExternalChannelProjectionMetadata {
  try {
    return sanitizeExternalChannelProjectionMetadata(row.metadata);
  } catch {
    // Legacy/provider payloads are never propagated into a new write. Fail
    // closed to an empty bounded object instead of re-persisting unsafe data.
    return {};
  }
}

function hasActiveLifecycle(row: Pick<ExternalChannelProjectionRow, "lifecycle">): boolean {
  return row.lifecycle === "active";
}

export async function reserveExternalChannelProjection(
  db: ProjectionStore,
  input: ExternalChannelProjectionReservation,
): Promise<ProjectionReservationResult> {
  const identity = projectionIdentity(input);
  const where = sourceIdentityWhere(identity);
  let existing = await db.externalChannelProjection.findUnique({ where });
  if (existing) {
    if (!hasActiveLifecycle(existing)) return err("invalid-state");
    if (existing.state === "ambiguous") return err("ambiguous-requires-reconciliation");
    if (["drifted", "detached"].includes(existing.state)) return err("invalid-state");
    const credentialChanged = existing.credentialId !== (input.credentialId ?? null);
    const sourceChanged = existing.sourceVersion !== input.sourceVersion
      || existing.localFingerprint !== input.localFingerprint;
    if (credentialChanged || sourceChanged) {
      existing = await db.externalChannelProjection.update({
        where: { externalChannelProjectionId: existing.externalChannelProjectionId },
        data: sourceChanged
          ? {
              credentialId: input.credentialId ?? null,
              sourceVersion: normalizedIdentityPart(input.sourceVersion, "sourceVersion"),
              localFingerprint: normalizedIdentityPart(input.localFingerprint, "localFingerprint"),
              metadata: sanitizeExternalChannelProjectionMetadata(input.metadata),
              state: "reserved",
              reservedAt: new Date(),
            }
          : { credentialId: input.credentialId ?? null },
      });
    }
    return ok({ mode: "existing", projection: existing });
  }

  const now = new Date();
  const data = {
    externalChannelProjectionId: projectionIdFor(identity),
    ...identity,
    credentialId: input.credentialId ?? null,
    sourceVersion: normalizedIdentityPart(input.sourceVersion, "sourceVersion"),
    externalRef: null,
    externalUrl: null,
    localFingerprint: normalizedIdentityPart(input.localFingerprint, "localFingerprint"),
    remoteFingerprint: null,
    remoteModifiedAt: null,
    state: "reserved" as const,
    metadata: sanitizeExternalChannelProjectionMetadata(input.metadata),
    reservedAt: now,
    projectedAt: null,
    observedAt: null,
    driftedAt: null,
    detachedAt: null,
    lifecycle: "active" as const,
    lifecycleAt: null,
    lifecycleReason: null,
  };
  try {
    const projection = await db.externalChannelProjection.create({ data });
    return ok({ mode: "reserved", projection });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await db.externalChannelProjection.findUnique({ where });
    if (!winner) throw error;
    if (!hasActiveLifecycle(winner)) return err("invalid-state");
    if (winner.state === "ambiguous") return err("ambiguous-requires-reconciliation");
    return ok({ mode: "existing", projection: winner });
  }
}

export function findExternalChannelProjectionBySource(
  db: ProjectionStore,
  input: Pick<ExternalChannelProjectionReservation, "connectorKey" | "connectionId" | "sourceType" | "sourceId" | "resourceKind" | "locale">,
): Promise<ExternalChannelProjectionRow | null> {
  const identity = projectionIdentity({
    ...input,
    sourceVersion: "lookup",
    localFingerprint: "lookup",
  });
  return db.externalChannelProjection.findUnique({ where: sourceIdentityWhere(identity) });
}

export function findExternalChannelProjectionByRemote(
  db: ProjectionStore,
  input: {
    connectorKey: string;
    connectionId: string;
    resourceKind: ExternalChannelResourceKind;
    externalId: string;
  },
): Promise<ExternalChannelProjectionRow | null> {
  return db.externalChannelProjection.findUnique({
    where: {
      connectorKey_connectionId_resourceKind_externalRef: {
        connectorKey: normalizedIdentityPart(input.connectorKey, "connectorKey"),
        connectionId: normalizedIdentityPart(input.connectionId, "connectionId"),
        resourceKind: input.resourceKind,
        externalRef: normalizedIdentityPart(input.externalId, "externalId"),
      },
    },
  });
}

export async function bindExternalChannelProjection(
  db: ProjectionStore,
  input: {
    projectionId: string;
    externalId: string;
    externalUrl: string | null;
    remoteFingerprint: string;
    remoteModifiedAt: Date | null;
  },
): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: input.projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing)) return err("invalid-state");
  if (existing.state === "ambiguous") return err("ambiguous-requires-reconciliation");
  if (existing.state === "detached") return err("invalid-state");
  try {
    const projection = await db.externalChannelProjection.update({
      where: { externalChannelProjectionId: input.projectionId },
      data: {
        externalRef: normalizedIdentityPart(input.externalId, "externalId"),
        externalUrl: input.externalUrl,
        remoteFingerprint: normalizedIdentityPart(input.remoteFingerprint, "remoteFingerprint"),
        remoteModifiedAt: input.remoteModifiedAt,
        state: "current",
        projectedAt: new Date(),
        observedAt: new Date(),
        driftedAt: null,
      },
    });
    return ok({ projection });
  } catch (error) {
    if (isUniqueConflict(error)) return err("remote-identity-conflict");
    throw error;
  }
}

export async function markExternalChannelProjectionAmbiguous(
  db: ProjectionStore,
  projectionId: string,
  reason: string,
): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing) || existing.state === "detached") return err("invalid-state");
  const projection = await db.externalChannelProjection.update({
    where: { externalChannelProjectionId: projectionId },
    data: {
      state: "ambiguous",
      metadata: sanitizeExternalChannelProjectionMetadata({ ...storedMetadata(existing), ambiguousReason: reason }),
    },
  });
  return ok({ projection });
}

export function canAutomaticallyRetryProjection(
  projection: Pick<ExternalChannelProjectionRow, "state" | "lifecycle">,
): boolean {
  return hasActiveLifecycle(projection) && projection.state !== "ambiguous" && projection.state !== "detached";
}

export async function reconcileAmbiguousExternalChannelProjection(
  db: ProjectionStore,
  input: {
    projectionId: string;
    externalId: string;
    externalUrl: string | null;
    remoteFingerprint: string;
    remoteModifiedAt: Date | null;
    evidence: unknown;
  },
): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: input.projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing)) return err("invalid-state");
  const count = await db.externalChannelProjection.updateMany({
    where: { externalChannelProjectionId: input.projectionId, state: "ambiguous" },
    data: {
      externalRef: normalizedIdentityPart(input.externalId, "externalId"),
      externalUrl: input.externalUrl,
      remoteFingerprint: normalizedIdentityPart(input.remoteFingerprint, "remoteFingerprint"),
      remoteModifiedAt: input.remoteModifiedAt,
      state: "current",
      projectedAt: new Date(),
      observedAt: new Date(),
      driftedAt: null,
      metadata: sanitizeExternalChannelProjectionMetadata({ ...storedMetadata(existing), ...sanitizeExternalChannelProjectionMetadata(input.evidence) }),
    },
  });
  if (count.count !== 1) return err("invalid-state");
  const projection = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: input.projectionId } });
  return projection ? ok({ projection }) : err("not-found");
}

export async function observeExternalChannelProjection(
  db: ProjectionStore,
  input: { projectionId: string; remoteFingerprint: string; remoteModifiedAt: Date | null },
): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: input.projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing) || ["ambiguous", "detached"].includes(existing.state)) return err("invalid-state");
  const remoteFingerprint = normalizedIdentityPart(input.remoteFingerprint, "remoteFingerprint");
  const drifted = remoteFingerprint !== existing.localFingerprint;
  const projection = await db.externalChannelProjection.update({
    where: { externalChannelProjectionId: input.projectionId },
    data: {
      remoteFingerprint,
      remoteModifiedAt: input.remoteModifiedAt,
      state: drifted ? "drifted" : "current",
      observedAt: new Date(),
      driftedAt: drifted ? new Date() : null,
    },
  });
  return ok({ projection });
}

async function detachProjection(
  db: ProjectionStore,
  projectionId: string,
): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing)) return err("invalid-state");
  const now = new Date();
  const projection = await db.externalChannelProjection.update({
    where: { externalChannelProjectionId: projectionId },
    data: { state: "detached", detachedAt: now },
  });
  return ok({ projection });
}

export function detachExternalChannelProjection(db: ProjectionStore, projectionId: string): Promise<ProjectionResult> {
  return detachProjection(db, projectionId);
}

export async function retireExternalChannelProjection(db: ProjectionStore, projectionId: string): Promise<ProjectionResult> {
  const existing = await db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: projectionId } });
  if (!existing) return err("not-found");
  if (!hasActiveLifecycle(existing)) return err("invalid-state");
  const projection = await db.externalChannelProjection.update({
    where: { externalChannelProjectionId: projectionId },
    data: { lifecycle: "retired", lifecycleAt: new Date(), lifecycleReason: "retired-by-operator" },
  });
  return ok({ projection });
}
