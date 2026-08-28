// The directory projection (EP-24741BBF · BI-DCE49BA9).
//
// One spine, three classes, one tree. A human employee, an AI coworker and a
// service account are three SHAPES of `Principal`, not three subsystems, and
// they project through this single path.
//
// The projection is DERIVED and READ-ONLY. There is deliberately no write path
// back through it: the directory is authoritative because it is computed from
// the spine, not because it is a second place to edit identity. That is the
// difference between publishing identity and forking it.
//
// It is also FINGERPRINTED, so a consumer can tell "nothing changed" from "I am
// serving something stale" — a distinction a directory cannot afford to blur.

import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  branchDn,
  deriveBaseDn,
  groupDn,
  principalDn,
  type DirectoryBranch,
} from "./dn";
import {
  GROUP_OBJECT_CLASSES,
  OBJECT_CLASSES,
  PUBLISHED_ATTRIBUTES,
  PUBLISHED_GROUP_ATTRIBUTES,
  PUBLISHED_KINDS,
  PUBLISHED_STATUS,
  applyPublicationAllowlist,
} from "./schema";

export type DirectoryEntry = {
  dn: string;
  branch: DirectoryBranch;
  attributes: Record<string, string[]>;
};

export type DirectoryProjection = {
  baseDn: string;
  entries: DirectoryEntry[];
  /** Content fingerprint over the published entries. */
  fingerprint: string;
  counts: Record<DirectoryBranch, number>;
};

export type ProjectionDb = Pick<
  typeof prisma,
  "organization" | "principal" | "platformRole" | "team"
>;

/** Branch container entries (`ou=…`), so a subtree search returns a real tree. */
function branchEntries(baseDn: string): DirectoryEntry[] {
  return (["people", "agents", "services", "groups"] as DirectoryBranch[]).map((branch) => ({
    dn: branchDn(baseDn, branch),
    branch,
    attributes: {
      objectClass: ["top", "organizationalUnit"],
      ou: [branch],
    },
  }));
}

function aliasValue(
  aliases: Array<{ aliasType: string; aliasValue: string }>,
  type: string,
): string | undefined {
  return aliases.find((alias) => alias.aliasType === type)?.aliasValue;
}

/**
 * Load and build the published tree.
 *
 * Every attribute passes through `applyPublicationAllowlist` as the final step,
 * so even if this function loads a field it should not, the allowlist stops it
 * reaching a client.
 */
export async function buildDirectoryProjection(
  db: ProjectionDb = prisma,
): Promise<DirectoryProjection> {
  const organization = await db.organization.findFirst({
    select: { slug: true, website: true },
    orderBy: { createdAt: "asc" },
  });
  if (!organization) {
    throw new Error(
      "buildDirectoryProjection: no Organization exists, so no base DN can be derived. The directory is the organization's namespace and cannot be published without one.",
    );
  }
  const baseDn = deriveBaseDn(organization);

  const principals = await db.principal.findMany({
    where: { status: PUBLISHED_STATUS, kind: { in: Object.keys(PUBLISHED_KINDS) } },
    select: {
      principalId: true,
      kind: true,
      displayName: true,
      aliases: { select: { aliasType: true, aliasValue: true } },
    },
    orderBy: { principalId: "asc" },
  });

  // userId -> published DN, so group membership can name real entries.
  const dnByUserId = new Map<string, string>();
  const entries: DirectoryEntry[] = branchEntries(baseDn);

  for (const principal of principals) {
    const branch = PUBLISHED_KINDS[principal.kind];
    if (!branch) continue;

    const employeeId = aliasValue(principal.aliases, "employee");
    const gaid = aliasValue(principal.aliases, "gaid");
    const userId = aliasValue(principal.aliases, "user");
    const mail = aliasValue(principal.aliases, "mail");

    const dn = principalDn(baseDn, branch, principal.principalId);
    if (userId) dnByUserId.set(userId, dn);

    const candidate: Record<string, string[]> = {
      objectClass: OBJECT_CLASSES[branch],
      uid: [principal.principalId],
      cn: [principal.displayName],
      displayName: [principal.displayName],
      dpfPrincipalKind: [principal.kind],
      ...(mail ? { mail: [mail] } : {}),
      ...(employeeId ? { employeeNumber: [employeeId] } : {}),
      ...(gaid ? { dpfGaid: [gaid] } : {}),
    };

    entries.push({
      dn,
      branch,
      attributes: applyPublicationAllowlist(candidate, PUBLISHED_ATTRIBUTES[branch]),
    });
  }

  // Groups project ORGANIZATIONAL structure — roles and teams. They are not an
  // authorization API: no code may derive permission from membership alone.
  const roles = await db.platformRole.findMany({
    select: {
      roleId: true,
      name: true,
      description: true,
      users: { select: { userId: true } },
    },
    orderBy: { roleId: "asc" },
  });
  for (const role of roles) {
    const members = role.users
      .map((entry) => dnByUserId.get(entry.userId))
      .filter((value): value is string => Boolean(value));
    entries.push({
      dn: groupDn(baseDn, `role-${role.roleId}`),
      branch: "groups",
      attributes: applyPublicationAllowlist(
        {
          objectClass: [...GROUP_OBJECT_CLASSES],
          cn: [`role-${role.roleId}`],
          description: [role.description ?? role.name],
          member: members,
        },
        PUBLISHED_GROUP_ATTRIBUTES,
      ),
    });
  }

  const teams = await db.team.findMany({
    where: { status: "active" },
    select: {
      slug: true,
      name: true,
      description: true,
      memberships: { select: { userId: true } },
    },
    orderBy: { slug: "asc" },
  });
  for (const team of teams) {
    const members = team.memberships
      .map((entry) => dnByUserId.get(entry.userId))
      .filter((value): value is string => Boolean(value));
    entries.push({
      dn: groupDn(baseDn, `team-${team.slug}`),
      branch: "groups",
      attributes: applyPublicationAllowlist(
        {
          objectClass: [...GROUP_OBJECT_CLASSES],
          cn: [`team-${team.slug}`],
          description: [team.description ?? team.name],
          member: members,
        },
        PUBLISHED_GROUP_ATTRIBUTES,
      ),
    });
  }

  const counts = entries.reduce(
    (acc, entry) => {
      acc[entry.branch] += 1;
      return acc;
    },
    { people: 0, agents: 0, services: 0, groups: 0 } as Record<DirectoryBranch, number>,
  );

  return { baseDn, entries, fingerprint: fingerprintEntries(baseDn, entries), counts };
}

/**
 * Stable content fingerprint. Canonicalised (sorted DNs, sorted attribute names,
 * sorted values) so an equivalent tree always hashes the same — otherwise the
 * fingerprint would report drift on every rebuild and mean nothing.
 */
export function fingerprintEntries(baseDn: string, entries: DirectoryEntry[]): string {
  const canonical = entries
    .map((entry) => {
      const attrs = Object.keys(entry.attributes)
        .sort()
        .map((name) => `${name}:${[...entry.attributes[name]!].sort().join("|")}`)
        .join(";");
      return `${entry.dn.toLowerCase()}=>${attrs}`;
    })
    .sort()
    .join("\n");
  return createHash("sha256").update(`${baseDn.toLowerCase()}\n${canonical}`).digest("hex");
}
