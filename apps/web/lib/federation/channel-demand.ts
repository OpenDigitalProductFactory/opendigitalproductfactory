import { createHash } from "node:crypto";

import {
  audienceForOutboundRole,
  channelPolicySelectsRecord,
  forwardDemandEnvelope,
  forwardingGrantFromPolicy,
  type ChannelDemandPolicy,
} from "@dpf/db/federated-channel";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import {
  isFederationRole,
  type FederationRole,
} from "@dpf/db/federation-link-types";

import { isFederationSyncableBacklogStatus } from "@/lib/explore/backlog";

import {
  queueDemandProjection,
  queueDemandWithdrawal,
  queueForwardedDemand,
  type DemandDeliveryDb,
} from "./demand-delivery";
import { assertMayShareDemandCrossOrg } from "./cross-org-sharing";
import { decodeDemandMirrorPayload } from "./demand-exchange";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { relationshipPresetForRole } from "./demand-reconciliation";

interface ChannelLink {
  linkId: string;
  role: string;
  linkState: string;
  peerAuthorityUrl: string;
  peerTokenEnc: string | null;
  peerInstallationId: string | null;
  projectionContractId: string | null;
  revokedAt: Date | null;
  quarantinedAt: Date | null;
}

interface ChannelBacklogItem {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  sensitivity: string;
  scopeKind: string | null;
  workType: string | null;
  occurrenceCount: number;
  createdAt: Date;
  updatedAt: Date;
  digitalProduct: { productId: string } | null;
}

interface ChannelMirror {
  mirrorId: string;
  federationLinkId: string;
  canonicalSide: string;
  syncStatus: string;
  payload: unknown;
}

export interface ChannelDemandDb extends FederationIdentityDb, DemandDeliveryDb {
  federationLink: DemandDeliveryDb["federationLink"] & {
    findUnique(args: unknown): Promise<ChannelLink | null>;
    update(args: unknown): Promise<unknown>;
  };
  backlogItem: {
    findUnique(args: unknown): Promise<ChannelBacklogItem | null>;
  };
  projectionContract: {
    findFirst(args: unknown): Promise<{ cadaPosture: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  federatedRecordMirror: DemandDeliveryDb["federatedRecordMirror"] & {
    findUnique(args: unknown): Promise<(ChannelMirror & { version: bigint }) | null>;
  };
}

const PARTNER_ROLES = new Set<FederationRole>([
  "manages",
  "managed-by",
  "channel-upstream",
  "channel-downstream",
]);

export type OutboundDemandSharingRole = Extract<
  FederationRole,
  "managed-by" | "channel-downstream"
>;

const OUTBOUND_DEMAND_SHARING_ROLES = new Set<OutboundDemandSharingRole>([
  "managed-by",
  "channel-downstream",
]);

export function isOutboundDemandSharingRole(
  role: string,
): role is OutboundDemandSharingRole {
  return isFederationRole(role)
    && OUTBOUND_DEMAND_SHARING_ROLES.has(role as OutboundDemandSharingRole);
}

export async function bindPeerInstallationIdentity(
  db: { federationLink: { updateMany(args: unknown): Promise<{ count: number }> } },
  linkId: string,
  peerInstallationId: string,
): Promise<{ peerInstallationId: string }> {
  const updated = await db.federationLink.updateMany({
    where: {
      linkId,
      OR: [{ peerInstallationId: null }, { peerInstallationId }],
    },
    data: { peerInstallationId },
  });
  if (updated.count !== 1) {
    throw new Error("Peer installation identity does not match this connection.");
  }
  return { peerInstallationId };
}

function assertTrustedPartnerLink(link: ChannelLink | null): asserts link is ChannelLink & { role: FederationRole } {
  if (!link) throw new Error("Federation link was not found.");
  if (!isFederationRole(link.role) || !PARTNER_ROLES.has(link.role)) {
    throw new Error("This connection is not a service-provider or channel relationship.");
  }
  if (link.linkState !== "trusted" || link.revokedAt || link.quarantinedAt) {
    throw new Error("Only a trusted, active connection can share demand.");
  }
}

// Cross-org content redaction (BI-DC4E526E). The raw backlog BODY may hold a
// customer's internal detail, so it must NEVER cross an organization boundary —
// even for platform demand. The projected cross-org summary is the operator's
// concise TITLE only (bounded), automatically; the body stays local. No operator
// step is required (cognitive-load aversion): the safe minimum is the default, and
// an operator-authored shareable summary can be layered on later if richer upstream
// context is ever wanted.
function redactedCrossOrgSummary(title: string): string {
  return (title.trim() || "Shared demand").slice(0, 240);
}

export function decodeChannelDemandPolicy(value: unknown): ChannelDemandPolicy {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const candidate = root.demandChannelPolicy && typeof root.demandChannelPolicy === "object"
    && !Array.isArray(root.demandChannelPolicy)
    ? root.demandChannelPolicy as Record<string, unknown>
    : {};
  const refs = Array.isArray(candidate.selectedRecordRefs)
    ? candidate.selectedRecordRefs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0).slice(0, 5_000)
    : [];
  const forwardingAudiences = Array.isArray(candidate.forwardingAudiences)
    ? candidate.forwardingAudiences.filter(
        (audience): audience is "founder" => audience === "founder",
      )
    : [];
  return {
    mode: "explicit",
    selectedRecordRefs: [...new Set(refs)],
    attribution: candidate.attribution === "named" || candidate.attribution === "organization"
      || candidate.attribution === "anonymous"
      ? candidate.attribution
      : "pseudonymous",
    allowTransitiveForwarding: candidate.allowTransitiveForwarding === true,
    forwardingAudiences: [...new Set(forwardingAudiences)],
    ...(typeof candidate.forwardingExpiresAt === "string"
      ? { forwardingExpiresAt: candidate.forwardingExpiresAt }
      : {}),
  };
}

function contractId(linkId: string): string {
  return `PC-CHANNEL-${createHash("sha256").update(linkId).digest("hex").slice(0, 16).toUpperCase()}`;
}

async function storePolicy(
  db: ChannelDemandDb,
  link: ChannelLink,
  policy: ChannelDemandPolicy,
): Promise<void> {
  const preset = relationshipPresetForRole(link.role);
  if (preset !== "channel" && preset !== "service-provider") {
    throw new Error("Partner demand policy requires a channel or service-provider link.");
  }
  const template = DEMAND_PROJECTION_TEMPLATES[preset];
  const id = contractId(link.linkId);
  await db.projectionContract.upsert({
    where: { contractId: id },
    create: {
      contractId: id,
      federationLinkId: link.linkId,
      includeSlices: template.includeSlices,
      excludeSlices: template.excludeSlices,
      fieldAllowList: template.fieldAllowList,
      retentionClass: template.retentionClass,
      cadaPosture: { demandChannelPolicy: policy },
    },
    update: {
      includeSlices: template.includeSlices,
      excludeSlices: template.excludeSlices,
      fieldAllowList: template.fieldAllowList,
      retentionClass: template.retentionClass,
      cadaPosture: { demandChannelPolicy: policy },
    },
  });
  if (link.projectionContractId !== id) {
    await db.federationLink.update({
      where: { linkId: link.linkId },
      data: { projectionContractId: id },
    });
  }
}

export async function selectLocalDemandForLink(
  db: ChannelDemandDb,
  input: {
    linkId: string;
    itemId: string;
    attribution?: ChannelDemandPolicy["attribution"];
    allowForwardToFounder?: boolean;
    forwardingExpiresAt?: string;
    now?: Date;
  },
  deps: {
    resolveIdentity?: typeof resolveFederationIdentity;
    queueProjection?: typeof queueDemandProjection;
  } = {},
) {
  const [link, item, stored] = await Promise.all([
    db.federationLink.findUnique({ where: { linkId: input.linkId } }),
    db.backlogItem.findUnique({
      where: { itemId: input.itemId },
      select: {
        itemId: true,
        title: true,
        body: true,
        status: true,
        sensitivity: true,
        scopeKind: true,
        workType: true,
        occurrenceCount: true,
        createdAt: true,
        updatedAt: true,
        digitalProduct: { select: { productId: true } },
      },
    }),
    db.projectionContract.findFirst({
      where: { federationLinkId: input.linkId },
      select: { cadaPosture: true },
    }),
  ]);
  assertTrustedPartnerLink(link);
  if (!isOutboundDemandSharingRole(link.role)) {
    throw new Error(
      "Local demand can only be shared toward your distributor or Founder Hub.",
    );
  }
  if (!item) throw new Error("Local demand item was not found.");
  if (!isFederationSyncableBacklogStatus(item.status)) {
    throw new Error("Closed backlog items cannot be shared; only open demand is projected to a connection.");
  }
  if ((item.body ?? "").includes("[origin:federatedDemand:")) {
    throw new Error("Adopted demand must use governed forwarding so original provenance is preserved.");
  }
  if ((item.body ?? "").includes("[origin:federatedWork:")) {
    throw new Error("This item is mirrored from another installation in your organization; share it from the installation that owns it.");
  }
  // Cross-org gate (BI-DC4E526E, kernel DI-3E77E48D5710) — CONTEXT-DERIVED, so no
  // manual per-item classification is required for correct behavior (cognitive-load
  // aversion): PLATFORM demand (dpf-portal / scopeKind=platform) auto-flows upstream
  // to the vendor; a customer's OWN domain work (their internal infrastructure /
  // operations) never leaves by default. Sensitivity is only a rare override.
  assertMayShareDemandCrossOrg({
    sensitivity: item.sensitivity,
    digitalProductId: item.digitalProduct?.productId ?? null,
    scopeKind: item.scopeKind,
  });
  const preset = relationshipPresetForRole(link.role);
  if (preset !== "channel" && preset !== "service-provider") {
    throw new Error("This relationship cannot receive explicitly shared demand.");
  }
  if (link.role === "channel-downstream" && input.allowForwardToFounder === true) {
    throw new Error("Founder forwarding consent applies only when sharing with a distributor.");
  }
  const current = decodeChannelDemandPolicy(stored?.cadaPosture);
  const policy: ChannelDemandPolicy = {
    ...current,
    selectedRecordRefs: [...new Set([...current.selectedRecordRefs, item.itemId])],
    attribution: input.attribution ?? current.attribution,
    allowTransitiveForwarding: input.allowForwardToFounder === true,
    forwardingAudiences: input.allowForwardToFounder ? ["founder"] : [],
    ...(input.forwardingExpiresAt ? { forwardingExpiresAt: input.forwardingExpiresAt } : {}),
  };
  await storePolicy(db, link, policy);
  const identity = await (deps.resolveIdentity ?? resolveFederationIdentity)(db);
  const result = await (deps.queueProjection ?? queueDemandProjection)(db, {
    link,
    source: {
      localRecordRef: item.itemId,
      title: item.title,
      // Cross-org: title-only, never the raw body (see redactedCrossOrgSummary).
      summary: redactedCrossOrgSummary(item.title),
      workType: item.workType,
      occurrenceCount: item.occurrenceCount,
      product: item.digitalProduct?.productId ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    identity,
    contract: DEMAND_PROJECTION_TEMPLATES[preset],
    audience: audienceForOutboundRole(link.role),
    attribution: policy.attribution,
    forwarding: forwardingGrantFromPolicy(policy),
    now: input.now,
  });
  return { ...result, policy };
}

export async function unselectLocalDemandForLink(
  db: ChannelDemandDb,
  input: { linkId: string; itemId: string; now?: Date },
  deps: { queueWithdrawal?: typeof queueDemandWithdrawal } = {},
) {
  const [link, stored] = await Promise.all([
    db.federationLink.findUnique({ where: { linkId: input.linkId } }),
    db.projectionContract.findFirst({
      where: { federationLinkId: input.linkId },
      select: { cadaPosture: true },
    }),
  ]);
  assertTrustedPartnerLink(link);
  const current = decodeChannelDemandPolicy(stored?.cadaPosture);
  if (!channelPolicySelectsRecord(current, input.itemId)) {
    return { action: "noop" as const, policy: current };
  }
  const policy = {
    ...current,
    selectedRecordRefs: current.selectedRecordRefs.filter((ref) => ref !== input.itemId),
  };
  await storePolicy(db, link, policy);
  const result = await (deps.queueWithdrawal ?? queueDemandWithdrawal)(
    db,
    link.linkId,
    input.itemId,
    input.now,
  );
  return { ...result, policy };
}

export async function forwardIncomingDemandToLink(
  db: ChannelDemandDb,
  input: { mirrorId: string; targetLinkId: string; now?: Date },
  deps: {
    resolveIdentity?: typeof resolveFederationIdentity;
    queueForward?: typeof queueForwardedDemand;
  } = {},
) {
  const [mirror, target] = await Promise.all([
    db.federatedRecordMirror.findUnique({ where: { mirrorId: input.mirrorId } }),
    db.federationLink.findUnique({ where: { linkId: input.targetLinkId } }),
  ]);
  if (!mirror || mirror.canonicalSide !== "peer") throw new Error("Incoming shared demand was not found.");
  if (mirror.federationLinkId === input.targetLinkId) throw new Error("Demand cannot be forwarded back over its incoming link.");
  assertTrustedPartnerLink(target);
  if (target.role !== "channel-downstream") {
    throw new Error("Selective upstream forwarding requires a founder/channel-upstream peer.");
  }
  if (!target.peerInstallationId) {
    throw new Error("The target peer identity has not been reconciled yet.");
  }
  const current = decodeDemandMirrorPayload(mirror.payload);
  if (!current || current.disposition === "withdrawn" || mirror.syncStatus === "withdrawn") {
    throw new Error("Withdrawn or invalid demand cannot be forwarded.");
  }
  const identity = await (deps.resolveIdentity ?? resolveFederationIdentity)(db);
  const envelope = forwardDemandEnvelope({
    envelope: current.envelope,
    targetAudience: "founder",
    forwardingInstallationId: identity.installationId,
    receivingInstallationId: target.peerInstallationId,
    relationshipKind: "channel",
    linkId: target.linkId,
    now: input.now,
  });
  return (deps.queueForward ?? queueForwardedDemand)(db, {
    link: target,
    localMirrorRef: mirror.mirrorId,
    envelope,
    now: input.now,
  });
}
