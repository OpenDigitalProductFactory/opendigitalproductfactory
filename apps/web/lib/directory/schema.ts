// Directory schema: object classes and the publication allowlist
// (EP-24741BBF · BI-DCE49BA9).
//
// Two rules govern this file.
//
// 1. STANDARD CLASSES CARRY STANDARD ATTRIBUTES. A human, an agent and a
//    service account are all `inetOrgPerson`, so an ordinary LDAP client works
//    unmodified. DPF-specific facts ride on AUXILIARY classes (`dpfAgent`,
//    `dpfServiceAccount`) rather than overloading a standard attribute with a
//    meaning no other client would understand.
//
// 2. PUBLICATION IS AN ALLOWLIST, NEVER A BLOCKLIST. An attribute appears in
//    the directory only if it is named here. A new column on `Principal` is
//    invisible until someone deliberately publishes it. The failure mode is
//    therefore omission, not disclosure — the correct direction for a surface
//    that answers anonymous-ish network queries.

import type { DirectoryBranch } from "./dn";

/** Principal.kind values that are published, mapped to their branch. */
export const PUBLISHED_KINDS: Record<string, Exclude<DirectoryBranch, "groups">> = {
  human: "people",
  agent: "agents",
  service: "services",
};

/** Only an active principal is published. Inactive ones are ABSENT, not flagged. */
export const PUBLISHED_STATUS = "active";

export const OBJECT_CLASSES: Record<Exclude<DirectoryBranch, "groups">, string[]> = {
  people: ["top", "person", "organizationalPerson", "inetOrgPerson"],
  agents: ["top", "person", "organizationalPerson", "inetOrgPerson", "dpfAgent"],
  services: ["top", "person", "organizationalPerson", "inetOrgPerson", "dpfServiceAccount"],
};

export const GROUP_OBJECT_CLASSES = ["top", "groupOfNames"] as const;

/**
 * The allowlist. An attribute not named here is not published, whatever the
 * projection happens to have loaded.
 */
export const PUBLISHED_ATTRIBUTES: Record<Exclude<DirectoryBranch, "groups">, readonly string[]> = {
  people: ["objectClass", "uid", "cn", "displayName", "mail", "employeeNumber"],
  agents: ["objectClass", "uid", "cn", "displayName", "dpfPrincipalKind", "dpfGaid"],
  services: ["objectClass", "uid", "cn", "displayName", "dpfPrincipalKind"],
};

export const PUBLISHED_GROUP_ATTRIBUTES = ["objectClass", "cn", "description", "member"] as const;

/**
 * Withheld deliberately. This list is a SECURITY CONTROL, not documentation of
 * an oversight — each entry names why, so a future reader must argue against a
 * stated reason rather than assume nobody considered it.
 */
export const WITHHELD_ATTRIBUTES: ReadonlyArray<{ field: string; reason: string }> = [
  {
    field: "passwordHash",
    reason: "A credential never leaves the credential boundary, under any bind.",
  },
  {
    field: "sensitivityClearance",
    reason:
      "Reveals what a principal may reach, which is target-selection intelligence for an attacker.",
  },
  {
    field: "sponsorPrincipalId",
    reason:
      "Exposes the delegation graph and the human origin behind an agent or service account.",
  },
  {
    field: "authorityBindings",
    reason:
      "Authorization is not directory data. Groups project organizational structure; permission is resolved from grants intersected with role capabilities, never from group membership alone.",
  },
  {
    field: "toolGrants",
    reason: "Same as authorityBindings — capability is not published.",
  },
  {
    field: "status",
    reason:
      "An inactive principal is absent from the tree rather than present-and-flagged, so status never needs publishing.",
  },
  {
    field: "sponsorChain",
    reason: "Transitive form of sponsorPrincipalId; withheld for the same reason.",
  },
];

const WITHHELD_FIELDS = new Set(WITHHELD_ATTRIBUTES.map((entry) => entry.field));

/** True when a field is explicitly recorded as withheld. */
export function isWithheld(field: string): boolean {
  return WITHHELD_FIELDS.has(field);
}

/**
 * Drop anything the allowlist does not name. Applied as the LAST step of
 * building an entry, so a projection bug that loads too much still cannot
 * publish too much.
 */
export function applyPublicationAllowlist(
  attributes: Record<string, string[]>,
  allowed: readonly string[],
): Record<string, string[]> {
  const allowedSet = new Set(allowed);
  const filtered: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(attributes)) {
    if (!allowedSet.has(name)) continue;
    const kept = values.filter((value) => value.length > 0);
    if (kept.length > 0) filtered[name] = kept;
  }
  return filtered;
}
