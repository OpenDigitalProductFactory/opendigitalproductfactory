// Cross-install operational control plane · Slice 3 (BI-648F01A0).
//
// Reflect each same-organization peer's portal into THIS install's runtime-target
// registry, so `get_runtime_coordination_map` shows both installs instead of only
// localhost. The target is a summary of the peer's mirrored posture report — never
// a second source of truth: its status follows the report's freshness, its
// version string the report's served version, and its host URL the link's own
// peer authority (local knowledge, nothing that crossed the wire).
//
// Kind is `external-preview` on purpose: a peer install is never this install's
// final-acceptance surface, so it must not inherit the root-portal role.

import { prisma } from "@dpf/db";

import {
  registerRuntimeTarget,
  type RuntimeCoordinationDb,
} from "@/lib/runtime-coordination/runtime-targets";
import type { RuntimeTargetStatus } from "@/lib/runtime-coordination/types";

import { decodeOperationalPostureMirrorPayload } from "./operational-posture-exchange";
import {
  mapPeerPosture,
  type PostureFreshness,
  type PostureInstallView,
  type PostureLinkRow,
  type PostureMirrorRow,
} from "./operational-posture-read-model";

export function peerRuntimeTargetId(linkId: string): string {
  return `RT-PEER-${linkId.replace(/^link_/, "").toUpperCase()}`;
}

/** A fresh report means the peer is serving; a stale one is blocked pending news;
 *  a silent one has expired from the live footprint. */
export function peerRuntimeTargetStatus(freshness: PostureFreshness): RuntimeTargetStatus {
  if (freshness === "fresh") return "running";
  if (freshness === "stale") return "blocked";
  return "expired";
}

export async function reflectPeerRuntimeTargets(
  db: RuntimeCoordinationDb,
  input: {
    peers: readonly PostureInstallView[];
    links: ReadonlyArray<{ linkId: string; peerAuthorityUrl: string }>;
    now?: Date;
  },
  deps: { register?: typeof registerRuntimeTarget } = {},
): Promise<{ reflected: number }> {
  const now = input.now ?? new Date();
  const urlByLink = new Map(input.links.map((link) => [link.linkId, link.peerAuthorityUrl]));
  let reflected = 0;
  for (const peer of input.peers) {
    if (!peer.linkId) continue;
    const hostUrl = urlByLink.get(peer.linkId) ?? null;
    await (deps.register ?? registerRuntimeTarget)({
      db,
      now,
      input: {
        targetId: peerRuntimeTargetId(peer.linkId),
        kind: "external-preview",
        status: peerRuntimeTargetStatus(peer.freshness),
        hostUrl,
        serviceName: "portal",
        serviceVersion: `${peer.servedVersion}+${peer.servedSha}`,
        metadata: {
          federated: true,
          basis: "operational-posture mirror",
          federationLinkId: peer.linkId,
          originInstallationId: peer.installationId,
          peerLabel: peer.label,
          capturedAt: peer.capturedAt,
          receivedAt: peer.receivedAt,
          freshness: peer.freshness,
          health: peer.health.status,
          runtime: peer.runtime,
        },
      },
    });
    reflected++;
  }
  return { reflected };
}

export interface PeerRuntimeTargetSyncDb extends RuntimeCoordinationDb {
  federationLink: { findMany(args: unknown): Promise<PostureLinkRow[]> };
  federatedRecordMirror: { findMany(args: unknown): Promise<PostureMirrorRow[]> };
}

/** Cron entry point: read every trusted same-organization peer's mirrored posture
 *  and reflect it into the runtime-target registry. Runs on the receiving side
 *  on the federation cadence; nothing is dialled. */
export async function syncPeerRuntimeTargets(
  db: PeerRuntimeTargetSyncDb = prisma as unknown as PeerRuntimeTargetSyncDb,
  deps: { register?: typeof registerRuntimeTarget; now?: Date } = {},
): Promise<{ links: number; reflected: number }> {
  const now = deps.now ?? new Date();
  const links = await db.federationLink.findMany({
    where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, peerAuthorityUrl: true, principal: { select: { displayName: true } } },
  });
  if (links.length === 0) return { links: 0, reflected: 0 };
  const mirrors = await db.federatedRecordMirror.findMany({
    where: {
      federationLinkId: { in: links.map((link) => link.linkId) },
      recordType: "operational-posture",
      canonicalSide: "peer",
      syncStatus: "synced",
    },
    select: { federationLinkId: true, syncStatus: true, lastSyncedAt: true, payload: true },
  });
  const peers: PostureInstallView[] = [];
  for (const link of links) {
    const row = mirrors.find((mirror) => mirror.federationLinkId === link.linkId);
    const payload = row ? decodeOperationalPostureMirrorPayload(row.payload) : null;
    if (row && payload) peers.push(mapPeerPosture(link, payload.record, row.lastSyncedAt, now));
  }
  const result = await reflectPeerRuntimeTargets(db, { peers, links, now }, deps);
  return { links: links.length, reflected: result.reflected };
}
