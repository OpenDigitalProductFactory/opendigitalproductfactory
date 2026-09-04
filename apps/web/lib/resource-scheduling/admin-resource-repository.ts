import { createHash } from "node:crypto";
import { ALL_ARCHETYPES, readActivationProfile } from "@dpf/storefront-templates";

export type ManagedResourceLifecycle = "active" | "retired";

export interface ManagedResourceProfile {
  kindSlug: string;
  capacityUnit: string;
  maxCapacity: number;
}

export function resolveManagedResourceProfiles(input: {
  archetypeId?: string | null;
  activationProfile: unknown;
  allowedKindSlugs: readonly string[];
  capacityUnit: string;
}): ManagedResourceProfile[] {
  const currentBuiltIn = input.archetypeId
    ? ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === input.archetypeId)
    : undefined;
  const activation = readActivationProfile(
    currentBuiltIn?.activationProfile ?? input.activationProfile,
  );
  if (!activation?.processProfile.housesSubjects) return [];
  const allowed = new Set(input.allowedKindSlugs);
  return activation.processProfile.resourceKinds.filter(
    (kind) => allowed.has(kind.kindSlug) && kind.capacityUnit === input.capacityUnit,
  );
}

export interface ManagedResource {
  id: string;
  resourceKey?: string;
  organizationId?: string;
  storefrontId?: string | null;
  domain?: string;
  kindSlug: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  serviceArea: string | null;
  blockedReason: string | null;
  lifecycle: string;
  version: number;
}

interface ResourceDelegate {
  create(args: unknown): Promise<ManagedResource>;
  findFirst(args: unknown): Promise<ManagedResource | null>;
  findMany(args: unknown): Promise<ManagedResource[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

export interface AdminResourceClient {
  resource: ResourceDelegate;
}

export interface CanonicalResourceUpsertDelegate {
  upsert(args: unknown): Promise<{ id: string }>;
}

/**
 * The one canonical Resource persistence seam shared by vertical adapters.
 * Clone-specific mapping stays with the adapter; conflict-safe persistence and
 * sourceRef identity do not.
 */
export async function upsertCanonicalResourceDraft(
  delegate: CanonicalResourceUpsertDelegate,
  draft: { sourceRef?: string | null; [key: string]: unknown },
): Promise<{ id: string }> {
  if (!draft.sourceRef) {
    throw new ResourceCommandError("invalid_resource", "Canonical resource source identity is required.");
  }
  return delegate.upsert({
    where: { sourceRef: draft.sourceRef },
    create: draft,
    update: draft,
  });
}

export class ResourceCommandError extends Error {
  constructor(
    public readonly code:
      | "invalid_resource"
      | "resource_kind_not_allowed"
      | "resource_not_found"
      | "resource_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ResourceCommandError";
  }
}

const RESOURCE_SELECT = {
  id: true,
  resourceKey: true,
  organizationId: true,
  storefrontId: true,
  domain: true,
  kindSlug: true,
  label: true,
  capacity: true,
  capacityUnit: true,
  serviceArea: true,
  blockedReason: true,
  lifecycle: true,
  version: true,
} as const;

function resolveProfile(
  profiles: readonly ManagedResourceProfile[],
  kindSlug: string,
): ManagedResourceProfile {
  const profile = profiles.find((candidate) => candidate.kindSlug === kindSlug);
  if (!profile) {
    throw new ResourceCommandError(
      "resource_kind_not_allowed",
      "Choose a housing kind configured for this organization.",
    );
  }
  return profile;
}

function cleanLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label.length > 120) {
    throw new ResourceCommandError(
      "invalid_resource",
      "Enter a housing label of 120 characters or fewer.",
    );
  }
  return label;
}

function validCapacity(value: unknown, profile: ManagedResourceProfile): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > profile.maxCapacity) {
    throw new ResourceCommandError(
      "invalid_resource",
      `Capacity must be between 1 and ${profile.maxCapacity} ${profile.capacityUnit}.`,
    );
  }
  return Number(value);
}

function stableResourceKey(idempotencyKey: string): string {
  return `managed-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

export async function listAdminResources(input: {
  db: AdminResourceClient;
  organizationId: string;
  domain: string;
  profiles: readonly ManagedResourceProfile[];
}): Promise<ManagedResource[]> {
  return input.db.resource.findMany({
    where: {
      organizationId: input.organizationId,
      domain: input.domain,
      kindSlug: { in: input.profiles.map((profile) => profile.kindSlug) },
    },
    orderBy: [{ lifecycle: "asc" }, { serviceArea: "asc" }, { label: "asc" }],
    select: RESOURCE_SELECT,
  });
}

export async function createAdminResource(input: {
  db: AdminResourceClient;
  organizationId: string;
  storefrontId: string | null;
  domain: string;
  profiles: readonly ManagedResourceProfile[];
  command: {
    label: string;
    kindSlug: string;
    serviceArea: string | null;
    capacity: number;
    idempotencyKey: string;
  };
}): Promise<ManagedResource> {
  const profile = resolveProfile(input.profiles, input.command.kindSlug);
  const label = cleanLabel(input.command.label);
  const capacity = validCapacity(input.command.capacity, profile);
  const resourceKey = stableResourceKey(input.command.idempotencyKey);

  const existing = await input.db.resource.findFirst({
    where: {
      organizationId: input.organizationId,
      domain: input.domain,
      resourceKey,
    },
    select: RESOURCE_SELECT,
  });
  if (existing) {
    const serviceArea = input.command.serviceArea?.trim() || null;
    if (
      existing.kindSlug !== profile.kindSlug ||
      existing.label !== label ||
      existing.capacity !== capacity ||
      existing.capacityUnit !== profile.capacityUnit ||
      existing.serviceArea !== serviceArea
    ) {
      throw new ResourceCommandError(
        "resource_conflict",
        "That retry key is already bound to different housing details.",
      );
    }
    return existing;
  }

  return input.db.resource.create({
    data: {
      resourceKey,
      organizationId: input.organizationId,
      storefrontId: input.storefrontId,
      domain: input.domain,
      kindSlug: profile.kindSlug,
      label,
      capacity,
      capacityUnit: profile.capacityUnit,
      serviceArea: input.command.serviceArea?.trim() || null,
      lifecycle: "active",
    },
    select: RESOURCE_SELECT,
  });
}

export async function updateAdminResource(input: {
  db: AdminResourceClient;
  organizationId: string;
  domain: string;
  profiles: readonly ManagedResourceProfile[];
  resourceId: string;
  command: {
    expectedVersion: number;
    label?: string;
    serviceArea?: string | null;
    capacity?: number;
    blockedReason?: string | null;
    lifecycle?: ManagedResourceLifecycle;
    idempotencyKey: string;
  };
}): Promise<ManagedResource> {
  const current = await input.db.resource.findFirst({
    where: {
      id: input.resourceId,
      organizationId: input.organizationId,
      domain: input.domain,
    },
    select: RESOURCE_SELECT,
  });
  if (!current) {
    throw new ResourceCommandError("resource_not_found", "Housing resource not found.");
  }
  const profile = resolveProfile(input.profiles, current.kindSlug);
  const data = {
    ...(input.command.label === undefined ? {} : { label: cleanLabel(input.command.label) }),
    ...(input.command.serviceArea === undefined
      ? {}
      : { serviceArea: input.command.serviceArea?.trim() || null }),
    ...(input.command.capacity === undefined
      ? {}
      : { capacity: validCapacity(input.command.capacity, profile) }),
    ...(input.command.blockedReason === undefined
      ? {}
      : { blockedReason: input.command.blockedReason?.trim() || null }),
    ...(input.command.lifecycle === undefined ? {} : { lifecycle: input.command.lifecycle }),
    version: { increment: 1 },
  };
  const changed = await input.db.resource.updateMany({
    where: {
      id: input.resourceId,
      organizationId: input.organizationId,
      version: input.command.expectedVersion,
    },
    data,
  });
  if (changed.count !== 1) {
    throw new ResourceCommandError(
      "resource_conflict",
      "This housing resource changed. Reload and review the latest values.",
    );
  }
  const updated = await input.db.resource.findFirst({
    where: { id: input.resourceId, organizationId: input.organizationId },
    select: RESOURCE_SELECT,
  });
  if (!updated) {
    throw new ResourceCommandError("resource_not_found", "Housing resource not found.");
  }
  return updated;
}
