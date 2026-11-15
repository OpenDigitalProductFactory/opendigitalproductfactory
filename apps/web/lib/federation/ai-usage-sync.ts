// BI-6361A930: pull each paired same-organization install's AI plan usage.
//
// Runs on the demand-reconciliation cadence right after work sync, over the
// same trusted link and peer-issued token. The last pull per link is kept in
// PlatformConfig (PEER_AI_USAGE_KEY); a failed pull keeps the last usage that
// landed, so the Finance page can say "as of" instead of dropping it.
// Never throws for one link's sake. DB-injected for unit tests.

import { prisma } from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  classifyAiUsageFetchFailure,
  mergePeerAiUsageRecord,
  parsePeerAiUsageRecord,
  PEER_AI_USAGE_KEY,
  SAME_ORG_PEER_LINK_WHERE,
  validateFederatedAiUsageV1,
  type FederatedAiUsageV1,
  type PeerAiUsagePull,
  type PeerAiUsageRecordV1,
} from "./ai-usage-exchange";
import { fetchAiUsageFromPeer, type PeerPostResult } from "./client";
import { decryptPeerToken } from "./outbound";

export interface AiUsageSyncLink {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
  peerInstallationId: string | null;
}

export interface AiUsageSyncDb {
  federationLink: { findMany(args: unknown): Promise<AiUsageSyncLink[]> };
  platformConfig: {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export type FetchAiUsage = (target: { peerAuthorityUrl: string; linkToken: string; linkId: string; sameOrgLan: boolean }) => Promise<PeerPostResult>;

async function sameOrganizationLinks(db: Pick<AiUsageSyncDb, "federationLink">): Promise<AiUsageSyncLink[]> {
  const links = await db.federationLink.findMany({
    where: SAME_ORG_PEER_LINK_WHERE,
    select: { linkId: true, role: true, peerAuthorityUrl: true, peerTokenEnc: true, peerInstallationId: true },
    orderBy: { linkId: "asc" },
  });
  // The query already asks for same-org peers; the filter keeps a mock or a widened query honest.
  return links.filter((link) => link.role === "same-org-peer");
}

async function pullLink(
  link: AiUsageSyncLink,
  deps: { fetchUsage: FetchAiUsage; decryptToken: typeof decryptPeerToken },
): Promise<PeerAiUsagePull> {
  const token = deps.decryptToken(link.peerTokenEnc);
  if (!token) return { linkId: link.linkId, outcome: "no-token", detail: "This link holds no peer-issued token." };
  const response = await deps.fetchUsage({
    peerAuthorityUrl: link.peerAuthorityUrl, linkToken: token, linkId: link.linkId, sameOrgLan: link.role === "same-org-peer",
  });
  if (!response.ok) {
    return {
      linkId: link.linkId,
      outcome: classifyAiUsageFetchFailure(response.status),
      detail: `Peer responded ${response.status}${response.error ? `: ${response.error}` : ""}`,
    };
  }
  const violations = validateFederatedAiUsageV1(response.body);
  if (violations.length > 0) return { linkId: link.linkId, outcome: "invalid", detail: violations.slice(0, 5).join(", ") };
  const usage = response.body as FederatedAiUsageV1;
  // The link is bound to one installation by work sync; usage from any other is not this peer's.
  if (link.peerInstallationId && usage.originInstallationId !== link.peerInstallationId) {
    return { linkId: link.linkId, outcome: "identity-mismatch",
      detail: `Usage came from ${usage.originInstallationId}, but this link belongs to ${link.peerInstallationId}.` };
  }
  return { linkId: link.linkId, outcome: "pulled", usage };
}

export type AiUsageSyncResult = { linksChecked: number; pulled: number; links: Array<{ linkId: string; outcome: string; detail: string | null; rows: number }> };

export async function runPeerAiUsageSync(
  db: AiUsageSyncDb = prisma as unknown as AiUsageSyncDb,
  deps: { fetchUsage?: FetchAiUsage; decryptToken?: typeof decryptPeerToken; now?: Date } = {},
): Promise<AiUsageSyncResult> {
  const now = deps.now ?? new Date();
  const fetchUsage = deps.fetchUsage ?? ((target) => fetchAiUsageFromPeer(target));
  const decryptToken = deps.decryptToken ?? decryptPeerToken;
  const links = await sameOrganizationLinks(db);
  const pulls: PeerAiUsagePull[] = [];
  for (const link of links) {
    try {
      pulls.push(await pullLink(link, { fetchUsage, decryptToken }));
    } catch (error) {
      pulls.push({ linkId: link.linkId, outcome: "unreachable", detail: getErrorMessage(error) });
    }
  }
  const previous = await db.platformConfig.findUnique({ where: { key: PEER_AI_USAGE_KEY }, select: { value: true } });
  const record: PeerAiUsageRecordV1 = mergePeerAiUsageRecord(parsePeerAiUsageRecord(previous?.value), pulls, now);
  await db.platformConfig.upsert({ where: { key: PEER_AI_USAGE_KEY }, create: { key: PEER_AI_USAGE_KEY, value: record }, update: { value: record } });
  const summary = pulls.map((p) => ({
    linkId: p.linkId, outcome: p.outcome, detail: p.outcome === "pulled" ? null : p.detail, rows: p.outcome === "pulled" ? p.usage.rows.length : 0,
  }));
  for (const s of summary) console.log(`[ai-usage-sync] ${s.linkId} ${s.outcome} rows=${s.rows}${s.detail ? ` — ${s.detail}` : ""}`);
  return { linksChecked: pulls.length, pulled: pulls.filter((p) => p.outcome === "pulled").length, links: summary };
}
