import { prisma } from "@dpf/db";

import { postToPeer } from "./client";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { decryptPeerToken } from "./outbound";
import type { NearbyFederationCandidate } from "./nearby-candidates";
import {
  introductionId,
  parseIntroductionEnvelope,
  selectIntroductionsForPeer,
  type FederationIntroductionEnvelope,
} from "./introductions";

const INTRODUCTION_TTL_MS = 10 * 60_000;

interface ExchangeLink {
  linkId: string;
  role: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
  peerInstallationId: string | null;
  peerDeviceId: string | null;
  linkState: string;
  offersIntroductions: boolean;
  acceptsIntroductions: boolean;
  revokedAt: Date | null;
  quarantinedAt: Date | null;
  principal: { displayName: string };
}

interface IntroductionCandidateRow {
  introductionId: string;
  authorityUrl: string;
  deviceId: string;
  displayName: string;
  relationshipHint: string;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface IntroductionExchangeDb extends FederationIdentityDb {
  federationLink: {
    findUnique(args: unknown): Promise<ExchangeLink | null>;
    findMany(args: unknown): Promise<ExchangeLink[]>;
  };
  federationIntroductionCandidate: {
    findFirst(args: unknown): Promise<IntroductionCandidateRow | null>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export async function findActiveIntroducedCandidate(
  db: IntroductionExchangeDb,
  input: { introductionId: string; authorityUrl: string; now?: Date },
): Promise<NearbyFederationCandidate | null> {
  const introduced = await db.federationIntroductionCandidate.findFirst({
    where: {
      introductionId: input.introductionId,
      authorityUrl: input.authorityUrl,
      withdrawnAt: null,
      dismissedAt: null,
      pairedFederationLinkId: null,
      expiresAt: { gt: input.now ?? new Date() },
      introducerLink: {
        linkState: "trusted",
        acceptsIntroductions: true,
        revokedAt: null,
        quarantinedAt: null,
      },
    },
  });
  return introduced ? {
    discoveryId: introduced.introductionId,
    endpoint: introduced.authorityUrl,
    protocol: "1",
    capabilityDigest: introduced.deviceId,
    pairPath: "/connect/pair",
    observedAt: introduced.lastSeenAt.toISOString(),
    expiresAt: introduced.expiresAt.toISOString(),
    automaticPairing: "tls-validation-required",
    displayName: introduced.displayName,
    source: "introducer",
    relationshipHint: introduced.relationshipHint,
  } : null;
}

export async function introductionsForAuthenticatedPeer(
  db: IntroductionExchangeDb,
  requesterLinkId: string,
): Promise<FederationIntroductionEnvelope[]> {
  const [identity, requester, links] = await Promise.all([
    resolveFederationIdentity(db),
    db.federationLink.findUnique({
      where: { linkId: requesterLinkId },
      include: { principal: { select: { displayName: true } } },
    }),
    db.federationLink.findMany({
      where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
      include: { principal: { select: { displayName: true } } },
    }),
  ]);
  if (!requester || requester.linkState !== "trusted") return [];
  return selectIntroductionsForPeer({
    localInstallationId: identity.installationId,
    requesterInstallationId: requester.peerInstallationId ?? "",
    requesterRole: requester.role,
    offersIntroductions: requester.offersIntroductions,
    links: links.map((link) => ({
      linkId: link.linkId,
      installationId: link.peerInstallationId,
      deviceId: link.peerDeviceId,
      displayName: link.principal.displayName,
      authorityUrl: link.peerAuthorityUrl,
      role: link.role,
      trusted: link.linkState === "trusted" && !link.revokedAt && !link.quarantinedAt,
    })),
  });
}

export async function syncFederationIntroductions(
  db: IntroductionExchangeDb = prisma as unknown as IntroductionExchangeDb,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    resolveIdentity?: typeof resolveFederationIdentity;
    decryptToken?: typeof decryptPeerToken;
    post?: typeof postToPeer;
  } = {},
): Promise<{ linksChecked: number; candidates: number; rejected: number; failed: number }> {
  const now = options.now ?? new Date();
  const [identity, links] = await Promise.all([
    (options.resolveIdentity ?? resolveFederationIdentity)(db),
    db.federationLink.findMany({
      where: {
        linkState: "trusted", acceptsIntroductions: true,
        revokedAt: null, quarantinedAt: null,
      },
      include: { principal: { select: { displayName: true } } },
    }),
  ]);
  let candidates = 0;
  let rejected = 0;
  let failed = 0;
  for (const link of links) {
    const token = (options.decryptToken ?? decryptPeerToken)(link.peerTokenEnc);
    if (!token) { failed++; continue; }
    const response = await (options.post ?? postToPeer)({
      peerAuthorityUrl: link.peerAuthorityUrl,
      linkToken: token,
      path: "/api/v1/federation/introductions",
      cloudEvent: { type: "dpf.federation.introductions.request" },
      sameOrgLan: link.role === "same-org-peer",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    if (!response.ok || !response.body || typeof response.body !== "object") { failed++; continue; }
    const offered = (response.body as { introductions?: unknown }).introductions;
    if (!Array.isArray(offered)) { failed++; continue; }
    const seen: string[] = [];
    for (const raw of offered) {
      const parsed = parseIntroductionEnvelope(raw, { localInstallationId: identity.installationId });
      if (!parsed.ok || parsed.value.installationId === link.peerInstallationId) { rejected++; continue; }
      const row = parsed.value;
      seen.push(row.installationId);
      candidates++;
      await db.federationIntroductionCandidate.upsert({
        where: { introducerLinkId_installationId: { introducerLinkId: link.linkId, installationId: row.installationId } },
        create: {
          introductionId: introductionId(link.linkId, row.installationId),
          introducerLinkId: link.linkId,
          ...row,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + INTRODUCTION_TTL_MS),
        },
        update: {
          deviceId: row.deviceId,
          displayName: row.displayName,
          authorityUrl: row.authorityUrl,
          relationshipHint: row.relationshipHint,
          introducedByPath: row.introducedByPath,
          hopCount: row.hopCount,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + INTRODUCTION_TTL_MS),
          withdrawnAt: null,
        },
      });
    }
    await db.federationIntroductionCandidate.updateMany({
      where: {
        introducerLinkId: link.linkId,
        withdrawnAt: null,
        ...(seen.length > 0 ? { installationId: { notIn: seen } } : {}),
      },
      data: { withdrawnAt: now },
    });
  }
  return { linksChecked: links.length, candidates, rejected, failed };
}
