// Deployment country declaration — the install-level switch and its effects
// (BI-06EA3167). Off by default. Turning it on declares this install's country
// on every upward link; turning it off withdraws it on the same links. The
// country is the organization's own canonical address, never typed twice.

import { prisma } from "@dpf/db";
import { DEPLOYMENT_DECLARATION_RECORD_TYPE } from "@dpf/db/federated-deployment-declaration-contract";

import { parseOrgAddress } from "@/lib/shared/org-address";

import type { DemandDeliveryDb } from "./demand-delivery";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import {
  buildDeploymentDeclaration,
  declaredDeploymentRows,
  DECLARING_LINK_ROLES,
  DEPLOYMENT_COUNTRY_SHARE_KEY,
  queueDeploymentDeclaration,
  RECEIVING_LINK_ROLES,
} from "./deployment-declaration-exchange";

export type DeploymentCountrySharing = {
  enabled: boolean;
  /** The country that is, or would be, shared; null when the organization has none. */
  countryCode: string | null;
  /** Peers that receive the declaration: links where this install is managed or supplied. */
  recipients: Array<{ linkId: string; peerName: string }>;
};

async function upwardLinks() {
  return prisma.federationLink.findMany({
    where: { role: { in: [...DECLARING_LINK_ROLES] }, linkState: "trusted", revokedAt: null },
    select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, principal: { select: { displayName: true } } },
    orderBy: { linkId: "asc" },
  });
}

function peerHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function organizationCountry(): Promise<string | null> {
  const organization = await prisma.organization.findFirst({ select: { address: true } });
  return parseOrgAddress(organization?.address).countryCode?.toUpperCase() ?? null;
}

export async function readDeploymentCountrySharing(): Promise<DeploymentCountrySharing> {
  const [row, countryCode, links] = await Promise.all([
    prisma.platformConfig.findUnique({ where: { key: DEPLOYMENT_COUNTRY_SHARE_KEY }, select: { value: true } }),
    organizationCountry(),
    upwardLinks(),
  ]);
  return {
    enabled: row?.value === true,
    countryCode,
    recipients: links.map((link) => ({ linkId: link.linkId, peerName: link.principal?.displayName ?? peerHost(link.peerAuthorityUrl) })),
  };
}

export type SetSharingResult = { ok: true; queued: number } | { ok: false; reason: "no-country" };

/** Turn sharing on or off, and queue the declaration or withdrawal on every upward link. */
export async function setDeploymentCountrySharing(enabled: boolean, now = new Date()): Promise<SetSharingResult> {
  const countryCode = await organizationCountry();
  if (enabled && !countryCode) return { ok: false, reason: "no-country" };
  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  const { record, violations } = buildDeploymentDeclaration({
    identity,
    state: enabled ? "declared" : "withdrawn",
    countryCode,
    now,
  });
  if (violations.length > 0) throw new Error(`Deployment declaration refused: ${violations.join(", ")}`);

  await prisma.platformConfig.upsert({
    where: { key: DEPLOYMENT_COUNTRY_SHARE_KEY },
    create: { key: DEPLOYMENT_COUNTRY_SHARE_KEY, value: enabled },
    update: { value: enabled },
  });
  const links = await upwardLinks();
  for (const link of links) {
    await queueDeploymentDeclaration(prisma as unknown as DemandDeliveryDb, { link, record, now });
  }
  return { ok: true, queued: links.length };
}

/** Deployment rows for the world view from installs that declare their country here. */
export async function loadDeclaredDeploymentRows(): Promise<Array<{ siteId: string; country: string }>> {
  // Only links that are still trusted count: revoking a link drops its declarations.
  const links = await prisma.federationLink.findMany({
    where: { role: { in: [...RECEIVING_LINK_ROLES] }, linkState: "trusted", revokedAt: null },
    select: { linkId: true },
  });
  if (links.length === 0) return [];
  const mirrors = await prisma.federatedRecordMirror.findMany({
    where: {
      recordType: DEPLOYMENT_DECLARATION_RECORD_TYPE,
      canonicalSide: "peer",
      syncStatus: "synced",
      federationLinkId: { in: links.map((link) => link.linkId) },
    },
    select: { syncStatus: true, payload: true },
  });
  return declaredDeploymentRows(mirrors);
}
