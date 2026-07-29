import type { SceneEntityRef } from "@dpf/storefront-templates";

export const OPERATIONAL_SCENE_ENTITY_KINDS = [
  "care-resource",
  "rentable-unit",
  "customer-site",
  "infra-ci",
  "table",
] as const;

export type OperationalSceneEntityKind =
  (typeof OPERATIONAL_SCENE_ENTITY_KINDS)[number];

export interface SceneOrganizationScope {
  id: string;
  orgId: string;
}

export interface SceneEntityRecord {
  entityKind: OperationalSceneEntityKind;
  id: string;
  label: string;
  operationalStatus: string;
  active: boolean | null;
  entityType?: string;
}

export interface SceneEntityLookupInput {
  kind: OperationalSceneEntityKind;
  ids: readonly string[];
  organization: SceneOrganizationScope;
}

export interface SceneEntityLookup {
  resolveOrganization(orgId: string): Promise<SceneOrganizationScope | null>;
  findMany(input: SceneEntityLookupInput): Promise<readonly SceneEntityRecord[]>;
}

export interface ResolvedSceneEntity {
  status: "resolved";
  ref: SceneEntityRef;
  label: string;
  operationalStatus: string;
  active: boolean | null;
  entityType?: string;
}

export interface MissingSceneEntity {
  status: "missing";
  ref: SceneEntityRef;
  reason:
    | "invalid-reference"
    | "organization-not-found"
    | "entity-not-found";
}

export interface UnsupportedSceneEntity {
  status: "unsupported";
  ref: SceneEntityRef;
  reason: "unsupported-kind";
}

export type SceneEntityResolution =
  | ResolvedSceneEntity
  | MissingSceneEntity
  | UnsupportedSceneEntity;

const SUPPORTED_KIND_SET = new Set<string>(OPERATIONAL_SCENE_ENTITY_KINDS);

export function isOperationalSceneEntityKind(
  kind: string,
): kind is OperationalSceneEntityKind {
  return SUPPORTED_KIND_SET.has(kind);
}

function entityKey(kind: OperationalSceneEntityKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Resolve placement references in bounded reads: one organization lookup and
 * at most one batched lookup per supported entity kind. The returned array
 * remains index-aligned with the placements supplied by the renderer.
 */
export async function resolveSceneEntityRefs(input: {
  orgId: string;
  refs: readonly SceneEntityRef[];
  lookup: SceneEntityLookup;
}): Promise<SceneEntityResolution[]> {
  const { orgId, refs, lookup } = input;
  const organization = await lookup.resolveOrganization(orgId);

  if (!organization) {
    return refs.map((ref) => {
      if (!isOperationalSceneEntityKind(ref.kind)) {
        return {
          status: "unsupported",
          ref,
          reason: "unsupported-kind",
        };
      }
      if (!ref.id.trim()) {
        return {
          status: "missing",
          ref,
          reason: "invalid-reference",
        };
      }
      return {
        status: "missing",
        ref,
        reason: "organization-not-found",
      };
    });
  }

  const idsByKind = new Map<OperationalSceneEntityKind, string[]>();
  const seenByKind = new Map<OperationalSceneEntityKind, Set<string>>();

  for (const ref of refs) {
    if (!isOperationalSceneEntityKind(ref.kind) || !ref.id.trim()) continue;
    const seen = seenByKind.get(ref.kind) ?? new Set<string>();
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    seenByKind.set(ref.kind, seen);
    const ids = idsByKind.get(ref.kind) ?? [];
    ids.push(ref.id);
    idsByKind.set(ref.kind, ids);
  }

  const batches = await Promise.all(
    [...idsByKind.entries()].map(async ([kind, ids]) =>
      lookup.findMany({ kind, ids, organization }),
    ),
  );
  const records = new Map<string, SceneEntityRecord>();
  for (const batch of batches) {
    for (const row of batch) {
      const key = entityKey(row.entityKind, row.id);
      if (!records.has(key)) records.set(key, row);
    }
  }

  return refs.map((ref): SceneEntityResolution => {
    if (!isOperationalSceneEntityKind(ref.kind)) {
      return {
        status: "unsupported",
        ref,
        reason: "unsupported-kind",
      };
    }
    if (!ref.id.trim()) {
      return {
        status: "missing",
        ref,
        reason: "invalid-reference",
      };
    }
    const row = records.get(entityKey(ref.kind, ref.id));
    if (!row) {
      return {
        status: "missing",
        ref,
        reason: "entity-not-found",
      };
    }
    return {
      status: "resolved",
      ref,
      label: row.label,
      operationalStatus: row.operationalStatus,
      active: row.active,
      ...(row.entityType ? { entityType: row.entityType } : {}),
    };
  });
}
