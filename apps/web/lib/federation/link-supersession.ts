// EP-ZERO-CONFIG-FEDERATION §5.3 — one link per same-organization peer.
//
// Every install/teardown cycle used to leave the surviving side with another
// trusted link to the same box, each pointing at a token the rebuilt peer no
// longer recognises. Nobody could tell which was live; the panel showed
// "waiting" for the dead ones forever. Rule: among non-revoked same-org links,
// group by the peer's installation id when known, else by its normalised
// authority URL; the newest enrolment wins and the rest are revoked with
// reason `superseded-by:<linkId>`. Monotone — a revoked link is never revived.

import { prisma } from "@dpf/db";

export interface SupersessionLinkRow {
  linkId: string;
  role: string;
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

/** Pure: decide which links a set of same-org links supersede. */
export function planSupersession(links: readonly SupersessionLinkRow[]): Array<{ linkId: string; supersededBy: string }> {
  const groups = new Map<string, SupersessionLinkRow[]>();
  for (const link of links) {
    if (link.role !== "same-org-peer") continue;
    const key = link.peerInstallationId ? `inst:${link.peerInstallationId}` : `url:${normalizeAuthorityUrl(link.peerAuthorityUrl)}`;
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  const plan: Array<{ linkId: string; supersededBy: string }> = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => {
      const ta = (a.enrolledAt ?? a.createdAt).getTime();
      const tb = (b.enrolledAt ?? b.createdAt).getTime();
      return tb - ta || a.linkId.localeCompare(b.linkId);
    });
    const winner = ordered[0]!;
    for (const loser of ordered.slice(1)) plan.push({ linkId: loser.linkId, supersededBy: winner.linkId });
  }
  return plan;
}

export async function supersedeStaleSameOrgLinks(
  db: SupersessionDb = prisma as unknown as SupersessionDb,
  now: Date = new Date(),
): Promise<{ revoked: Array<{ linkId: string; supersededBy: string }> }> {
  const links = await db.federationLink.findMany({
    where: { role: "same-org-peer", revokedAt: null },
    select: { linkId: true, role: true, peerAuthorityUrl: true, peerInstallationId: true, enrolledAt: true, createdAt: true },
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
