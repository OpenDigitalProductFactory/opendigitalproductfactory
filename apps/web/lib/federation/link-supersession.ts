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
  /** Most recent successful exchange over this link (mirror lastSyncedAt), if any. */
  lastActivityAt?: Date | null;
}

export interface SupersessionDb {
  federationLink: {
    findMany(args: unknown): Promise<SupersessionLinkRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  federatedRecordMirror?: {
    groupBy(args: unknown): Promise<Array<{ federationLinkId: string; _max: { lastSyncedAt: Date | null } }>>;
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

function activityMs(link: SupersessionLinkRow): number {
  return link.lastActivityAt ? link.lastActivityAt.getTime() : -1;
}

/** Trusted first; then the link that most recently exchanged anything (a link
 *  the peer actually answers on); then the newest enrolment; then id. */
function rank(a: SupersessionLinkRow, b: SupersessionLinkRow): number {
  return Number(isTrusted(b)) - Number(isTrusted(a))
    || activityMs(b) - activityMs(a)
    || enrolledMs(b) - enrolledMs(a)
    || a.linkId.localeCompare(b.linkId);
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
 * Trust outranks age, and liveness outranks age among trusted links: the link
 * that most recently exchanged anything is the one the peer actually answers
 * on (three "trusted" links to one box from earlier install cycles look alike
 * by state; only one still carries a token the peer recognises). A trusted
 * link is never superseded by a pending one. Every other link in the group is
 * superseded EXCEPT a pending link enrolled after the winner (a re-pairing in
 * flight; it supersedes the old one once it becomes trusted).
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
    const ranked = [...group].sort(rank);
    const trusted = ranked.filter(isTrusted);
    const winner = ranked[0]!;
    for (const link of ranked) {
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
  const activity = new Map<string, Date | null>();
  if (db.federatedRecordMirror) {
    for (const row of await db.federatedRecordMirror.groupBy({
      by: ["federationLinkId"],
      where: { federationLinkId: { in: links.map((link) => link.linkId) }, syncStatus: "synced" },
      _max: { lastSyncedAt: true },
    })) {
      activity.set(row.federationLinkId, row._max.lastSyncedAt);
    }
  }
  const plan = planSupersession(links.map((link) => ({ ...link, lastActivityAt: activity.get(link.linkId) ?? null })));
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
