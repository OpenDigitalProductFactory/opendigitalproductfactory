import { createHash, randomUUID } from "node:crypto";

import { prisma, Prisma } from "@dpf/db";
import {
  buildFounderClusterSummary,
  canEnterFounderProductionPortfolio,
  mergeFounderDemandRoutes,
  resolveFounderDemandEnvironment,
  type FounderClusterStatus,
  type FounderDemandEnvironment,
} from "@dpf/db/founder-shared-portfolio";

import { BACKLOG_WORK_TYPE_VALUES, type BacklogWorkType } from "@/lib/explore/backlog";
import { decodeDemandMirrorPayload } from "./demand-exchange";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { queueFounderDispositionNotices } from "./demand-disposition";

export interface FounderPortfolioInboxItem {
  mirrorId: string;
  title: string;
  summary: string;
  originInstallationId: string;
  envelopeId: string;
  environmentClass: FounderDemandEnvironment;
  routeCount: number;
  clusterId: string | null;
}

export interface FounderPortfolioClusterView {
  clusterId: string;
  title: string;
  status: FounderClusterStatus;
  confidence: number | null;
  founderDisposition: string | null;
  canonicalBacklogItemId: string | null;
  releaseApplicability: unknown;
  distinctOriginReach: number;
  routeCount: number;
  productionEligibleOrigins: number;
  members: Array<{
    memberId: string;
    originInstallationId: string;
    envelopeId: string;
    environmentClass: FounderDemandEnvironment;
    promotedAt: string | null;
    mirrorRefs: string[];
  }>;
}

function stableMemberId(originInstallationId: string, envelopeId: string): string {
  return `FDM-${createHash("sha256").update(`${originInstallationId}\u0000${envelopeId}`).digest("hex").slice(0, 16).toUpperCase()}`;
}

function asWorkType(value: unknown): BacklogWorkType {
  return typeof value === "string" && (BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(value)
    ? value as BacklogWorkType
    : "feature";
}

export async function getFounderSharedPortfolio(): Promise<{
  enabled: boolean;
  inbox: FounderPortfolioInboxItem[];
  clusters: FounderPortfolioClusterView[];
}> {
  const links = await prisma.federationLink.findMany({
    where: { role: "channel-upstream", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, metadata: true },
  });
  const linkById = new Map(links.map((link) => [link.linkId, link]));
  const [mirrors, clusters] = await Promise.all([
    prisma.federatedRecordMirror.findMany({
      where: {
        recordType: "demand-envelope",
        canonicalSide: "peer",
        syncStatus: { notIn: ["withdrawn", "revoked"] },
        federationLinkId: { in: links.map((link) => link.linkId) },
      },
      select: {
        mirrorId: true,
        federationLinkId: true,
        payload: true,
      },
      orderBy: { lastSyncedAt: "desc" },
      take: 500,
    }),
    prisma.founderDemandCluster.findMany({
      include: { members: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  const clusterByMirror = new Map<string, string>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      for (const mirrorId of member.mirrorRefs) clusterByMirror.set(mirrorId, cluster.clusterId);
    }
  }
  const inbox = mirrors.flatMap((mirror) => {
    const payload = decodeDemandMirrorPayload(mirror.payload);
    if (!payload) return [];
    return [{
      mirrorId: mirror.mirrorId,
      title: payload.envelope.title,
      summary: payload.envelope.summary,
      originInstallationId: payload.envelope.originInstallationId,
      envelopeId: payload.envelope.envelopeId,
      environmentClass: resolveFounderDemandEnvironment(linkById.get(mirror.federationLinkId)?.metadata),
      routeCount: Math.max(1, payload.envelope.route.length),
      clusterId: clusterByMirror.get(mirror.mirrorId) ?? null,
    }];
  });
  return {
    enabled: mirrors.length > 0 || clusters.length > 0,
    inbox,
    clusters: clusters.map((cluster) => {
      const members = cluster.members.map((member) => ({
        memberId: member.memberId,
        originKey: `${member.originInstallationId}:${member.envelopeId}`,
        originInstallationId: member.originInstallationId,
        envelopeId: member.envelopeId,
        environmentClass: member.environmentClass as FounderDemandEnvironment,
        promotedAt: member.promotedAt,
        mirrorRefs: member.mirrorRefs,
        routeAttestations: Array.isArray(member.routeAttestations) ? member.routeAttestations : [],
      }));
      const summary = buildFounderClusterSummary({
        status: cluster.status as FounderClusterStatus,
        canonicalBacklogItemId: cluster.canonicalBacklogItemId,
        members,
      });
      return {
        clusterId: cluster.clusterId,
        title: cluster.title,
        confidence: cluster.confidence,
        founderDisposition: cluster.founderDisposition,
        releaseApplicability: cluster.releaseApplicability,
        ...summary,
        members: members.map(({ originKey: _originKey, routeAttestations: _routeAttestations, ...member }) => ({
          ...member,
          promotedAt: member.promotedAt?.toISOString() ?? null,
        })),
      };
    }),
  };
}

export async function proposeFounderDemandCluster(input: {
  title: string;
  mirrorIds: string[];
  confidence?: number;
}) {
  const mirrorIds = [...new Set(input.mirrorIds.filter(Boolean))];
  if (!input.title.trim() || mirrorIds.length === 0) throw new Error("Choose at least one demand signal and name the cluster.");
  const links = await prisma.federationLink.findMany({
    where: { role: "channel-upstream", linkState: "trusted", revokedAt: null, quarantinedAt: null },
    select: { linkId: true, localOrganizationId: true, metadata: true },
  });
  const linkById = new Map(links.map((link) => [link.linkId, link]));
  const mirrors = await prisma.federatedRecordMirror.findMany({
    where: {
      mirrorId: { in: mirrorIds },
      recordType: "demand-envelope",
      canonicalSide: "peer",
      syncStatus: { notIn: ["withdrawn", "revoked"] },
      federationLinkId: { in: links.map((link) => link.linkId) },
    },
    select: {
      mirrorId: true,
      payload: true,
      federationLinkId: true,
    },
  });
  if (mirrors.length !== mirrorIds.length) throw new Error("One or more selected signals are unavailable or not from a trusted upstream channel.");
  const decoded = mirrors.map((mirror) => ({ mirror, payload: decodeDemandMirrorPayload(mirror.payload) }));
  if (decoded.some((row) => !row.payload)) throw new Error("One or more selected signals have an invalid demand envelope.");
  const routes = mergeFounderDemandRoutes(decoded.map(({ mirror, payload }) => ({
    originInstallationId: payload!.envelope.originInstallationId,
    envelopeId: payload!.envelope.envelopeId,
    mirrorId: mirror.mirrorId,
    environmentClass: resolveFounderDemandEnvironment(linkById.get(mirror.federationLinkId)?.metadata),
    routeAttestations: [{ ingressLinkId: mirror.federationLinkId }, ...payload!.envelope.route],
  })));
  const alreadyClustered = await prisma.founderDemandClusterMember.findFirst({
    where: { OR: routes.map((route) => ({ originInstallationId: route.originInstallationId, envelopeId: route.envelopeId })) },
    select: { cluster: { select: { clusterId: true } } },
  });
  if (alreadyClustered) throw new Error(`A selected origin is already in ${alreadyClustered.cluster.clusterId}.`);
  const organizationId = mirrors.map((row) => linkById.get(row.federationLinkId)?.localOrganizationId).find(Boolean)
    ?? (await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } }))?.id;
  if (!organizationId) throw new Error("Founder portfolio organization is not configured.");
  const clusterId = `FDC-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const byOrigin = new Map(decoded.map(({ payload }) => [
    `${payload!.envelope.originInstallationId}:${payload!.envelope.envelopeId}`,
    payload!.envelope,
  ]));
  return prisma.founderDemandCluster.create({
    data: {
      clusterId,
      organizationId,
      title: input.title.trim(),
      confidence: input.confidence ?? null,
      members: {
        create: routes.map((route) => ({
          memberId: stableMemberId(route.originInstallationId, route.envelopeId),
          originInstallationId: route.originInstallationId,
          envelopeId: route.envelopeId,
          environmentClass: route.environmentClass,
          mirrorRefs: route.mirrorRefs,
          routeAttestations: route.routeAttestations as Prisma.InputJsonValue,
          signalSnapshot: byOrigin.get(route.originKey) as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    select: { clusterId: true },
  });
}

export async function promoteFounderDemandOrigin(memberId: string, principalId: string) {
  return prisma.founderDemandClusterMember.update({
    where: { memberId },
    data: { promotedAt: new Date(), promotedByPrincipalId: principalId },
  });
}

export async function dispositionFounderDemandCluster(input: {
  clusterId: string;
  disposition: "accepted" | "rejected" | "archived";
  principalId: string;
  note?: string;
  releaseApplicability?: unknown;
}) {
  const cluster = await prisma.founderDemandCluster.findUnique({
    where: { clusterId: input.clusterId },
    include: { members: true },
  });
  if (!cluster) throw new Error("Founder demand cluster was not found.");
  let canonicalBacklogItemId = cluster.canonicalBacklogItemId;
  if (input.disposition === "accepted") {
    const blocked = cluster.members.filter((member) => !canEnterFounderProductionPortfolio(
      member.environmentClass as FounderDemandEnvironment,
      member.promotedAt,
    ));
    if (blocked.length > 0) throw new Error("Promote development/test origins explicitly before accepting this cluster.");
    if (!canonicalBacklogItemId) {
      const sample = cluster.members[0]?.signalSnapshot as Record<string, unknown> | undefined;
      const result = await ingestBacklogItem({
        title: cluster.title,
        body: `${typeof sample?.summary === "string" ? sample.summary : cluster.title}\n\nShared portfolio reach: ${cluster.members.length} distinct installation origin(s).`,
        workType: asWorkType(sample?.workType),
        source: "user-request",
        type: "portfolio",
        status: "triaging",
        origin: { kind: "founderDemandCluster", id: cluster.clusterId },
      });
      canonicalBacklogItemId = result.id;
    }
  }
  const updated = await prisma.founderDemandCluster.update({
    where: { clusterId: input.clusterId },
    data: {
      status: input.disposition,
      founderDisposition: input.note?.trim() || input.disposition,
      canonicalBacklogItemId,
      releaseApplicability: input.releaseApplicability === undefined
        ? undefined
        : input.releaseApplicability as Prisma.InputJsonValue,
      dispositionAt: new Date(),
      dispositionByPrincipalId: input.principalId,
    },
    select: { clusterId: true, status: true, canonicalBacklogItem: { select: { itemId: true } } },
  });
  await queueFounderDispositionNotices(prisma as never, {
    clusterId: cluster.clusterId,
    decision: input.disposition,
    message: input.note?.trim() || `Founder Hub ${input.disposition} this shared demand.`,
    members: cluster.members.map((member) => ({
      originInstallationId: member.originInstallationId,
      envelopeId: member.envelopeId,
      mirrorRefs: member.mirrorRefs,
    })),
  });
  return updated;
}
