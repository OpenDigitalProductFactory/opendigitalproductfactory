import { createHash } from "node:crypto";

import { isDeviceId } from "./instance-identity";

const MAX_INTRODUCTION_HOPS = 2;
const INSTALLATION_ID = /^inst_[a-f0-9]{32}$/;
const ALLOWED_HINTS = new Set([
  "same-org-peer",
  "manages",
  "managed-by",
  "channel-upstream",
  "channel-downstream",
  "community-peer",
]);

export interface FederationIntroductionEnvelope {
  installationId: string;
  deviceId: string;
  displayName: string;
  authorityUrl: string;
  relationshipHint: string;
  introducedByPath: string[];
  hopCount: number;
}

export interface IntroductionLinkCandidate {
  linkId: string;
  installationId: string | null;
  deviceId: string | null;
  displayName: string;
  authorityUrl: string;
  role: string;
  trusted: boolean;
  [extra: string]: unknown;
}

export function introductionId(introducerLinkId: string, installationId: string): string {
  return `fintro_${createHash("sha256").update(`${introducerLinkId}\u0000${installationId}`).digest("hex").slice(0, 24)}`;
}

export function selectIntroductionsForPeer(input: {
  localInstallationId: string;
  requesterInstallationId: string;
  requesterRole: string;
  offersIntroductions: boolean;
  links: IntroductionLinkCandidate[];
}): FederationIntroductionEnvelope[] {
  if (!input.offersIntroductions) return [];
  return input.links.flatMap((link) => {
    if (
      !link.trusted ||
      !link.installationId ||
      !link.deviceId ||
      link.installationId === input.requesterInstallationId ||
      link.installationId === input.localInstallationId ||
      !ALLOWED_HINTS.has(link.role)
    ) return [];
    // A customer/reseller link can learn upstream/channel peers; same-org peers
    // can learn same-org peers. Community peers never bridge into commercial
    // topology without an explicit direct relationship.
    const sameOrgPath = input.requesterRole === "same-org-peer" && link.role === "same-org-peer";
    const channelPath = input.requesterRole !== "community-peer" && link.role.startsWith("channel-");
    if (!sameOrgPath && !channelPath) return [];
    let authorityUrl: string;
    try {
      const url = new URL(link.authorityUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return [];
      authorityUrl = url.origin;
    } catch {
      return [];
    }
    return [{
      installationId: link.installationId,
      deviceId: link.deviceId,
      displayName: link.displayName.slice(0, 120),
      authorityUrl,
      relationshipHint: link.role,
      introducedByPath: [input.localInstallationId],
      hopCount: 1,
    }];
  });
}

export function parseIntroductionEnvelope(
  value: unknown,
  context: { localInstallationId: string },
): { ok: true; value: FederationIntroductionEnvelope } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Introduction must be an object." };
  }
  const row = value as Record<string, unknown>;
  const path = row.introducedByPath;
  if (
    typeof row.installationId !== "string" || !INSTALLATION_ID.test(row.installationId) ||
    typeof row.deviceId !== "string" || !isDeviceId(row.deviceId) ||
    typeof row.displayName !== "string" || row.displayName.trim().length === 0 || row.displayName.length > 120 ||
    typeof row.authorityUrl !== "string" ||
    typeof row.relationshipHint !== "string" || !ALLOWED_HINTS.has(row.relationshipHint) ||
    !Array.isArray(path) || !path.every((id) => typeof id === "string" && INSTALLATION_ID.test(id)) ||
    typeof row.hopCount !== "number" || !Number.isInteger(row.hopCount) || row.hopCount < 1 ||
    row.hopCount > MAX_INTRODUCTION_HOPS || path.length !== row.hopCount
  ) return { ok: false, message: "Introduction fields are invalid." };
  let authorityUrl: string;
  try {
    const url = new URL(row.authorityUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return { ok: false, message: "Introduced authority must be an HTTPS origin." };
    }
    authorityUrl = url.origin;
  } catch {
    return { ok: false, message: "Introduced authority is invalid." };
  }
  if (
    row.installationId === context.localInstallationId ||
    path.includes(context.localInstallationId) ||
    path.includes(row.installationId) ||
    new Set(path).size !== path.length
  ) return { ok: false, message: "Introduction loop rejected." };
  return { ok: true, value: {
    installationId: row.installationId,
    deviceId: row.deviceId,
    displayName: row.displayName.trim(),
    authorityUrl,
    relationshipHint: row.relationshipHint,
    introducedByPath: [...path],
    hopCount: row.hopCount,
  } };
}
