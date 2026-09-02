// EP-ZERO-CONFIG-FEDERATION §5.3 — one link per same-organization peer.
//
// Every install/teardown cycle used to leave the surviving side with another
// trusted link to the same box, each pointing at a token the rebuilt peer no
// longer recognises. Nobody could tell which was live; the panel showed
// "waiting" for the dead ones forever. Rule: among non-revoked same-org links,
// group by the peer's installation id AND its normalised authority URL (merged
// transitively); trust outranks age, then the newest enrolment wins, and the
// rest are revoked `superseded-by:<linkId>`. Monotone — never revived.

import { prisma } from "@dpf/db";

export interface SupersessionLinkRow {
  linkId: string;
  role: string;
  linkState: string;
  peerAuthorityUrl: string;
  peerInstallationId: string | null;
  enrolledAt: Date | null;
  createdAt: Date;
}

export interface SupersessionDb {
  federationLink: {
    findMany(args: unknown): Promise<SupersessionLinkRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export function normalizeAuthorityUrl(value: string): string {
  try {
    const url = new URL(value);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function isTrusted(link: SupersessionLinkRow): boolean {
  return link.linkState === "trusted";
}

function enrolledMs(link: SupersessionLinkRow): number {
  return (link.enrolledAt ?? link.createdAt).getTime();
}

/**
 * Pure: decide which links a set of same-org links supersede.
 *
 * Links to one peer are grouped by BOTH facts that identify it — the peer's
 * installation id when known and its normalised authority URL — merged
 * transitively, so a pending link that never learned the peer's id still lands
 * in the same group as the trusted link at the same address (a reinstalled
 * peer shows up as a new installation id at the old address).
 *
 * Trust outranks age: a trusted link is never superseded by a pending one. If
 * the group holds a trusted link, the newest trusted link wins and every other
 * link is superseded EXCEPT a pending link enrolled after the winner (a
 * re-pairing in flight; it supersedes the old one once it becomes trusted).
 * Without any trusted link, the newest wins.
 */
export function planSupersession(links: readonly SupersessionLinkRow[]): Array<{ linkId: string; supersededBy: string }> {
  const sameOrg = links.filter((link) => link.role === "same-org-peer");
  // Union-find over identity keys so a link joins every group it shares a key with.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const link of sameOrg) {
    const urlKey = `url:${normalizeAuthorityUrl(link.peerAuthorityUrl)}`;
    if (!parent.has(urlKey)) parent.set(urlKey, urlKey);
    if (link.peerInstallationId) {
      const instKey = `inst:${link.peerInstallationId}`;
      if (!parent.has(instKey)) parent.set(instKey, instKey);
      union(instKey, urlKey);
    }
  }
  const groups = new Map<string, SupersessionLinkRow[]>();
  for (const link of sameOrg) {
    const root = find(`url:${normalizeAuthorityUrl(link.peerAuthorityUrl)}`);
    groups.set(root, [...(groups.get(root) ?? []), link]);
  }

  const plan: Array<{ linkId: string; supersededBy: string }> = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byNewest = [...group].sort((a, b) => enrolledMs(b) - enrolledMs(a) || a.linkId.localeCompare(b.linkId));
    const trusted = byNewest.filter(isTrusted);
    const winner = trusted[0] ?? byNewest[0]!;
    for (const link of byNewest) {
      if (link.linkId === winner.linkId) continue;
      // A pending re-pairing newer than the trusted winner is in flight; leave it.
      if (trusted.length > 0 && !isTrusted(link) && enrolledMs(link) > enrolledMs(winner)) continue;
      plan.push({ linkId: link.linkId, supersededBy: winner.linkId });
    }
  }
  return plan;
}

export async function supersedeStaleSameOrgLinks(
  db: SupersessionDb = prisma as unknown as SupersessionDb,
  now: Date = new Date(),
): Promise<{ revoked: Array<{ linkId: string; supersededBy: string }> }> {
  const links = await db.federationLink.findMany({
    where: { role: "same-org-peer", revokedAt: null },
    select: { linkId: true, role: true, linkState: true, peerAuthorityUrl: true, peerInstallationId: true, enrolledAt: true, createdAt: true },
  });
  const plan = planSupersession(links);
  for (const entry of plan) {
    await db.federationLink.updateMany({
      where: { linkId: entry.linkId, revokedAt: null },
      data: {
        revokedAt: now,
        revocationReason: `superseded-by:${entry.supersededBy}`,
        linkState: "revoked",
        tokenHash: null,
      },
    });
    console.log(`[federation] link ${entry.linkId} superseded by ${entry.supersededBy}`);
  }
  return { revoked: plan };
}
