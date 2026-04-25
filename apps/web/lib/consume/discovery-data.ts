import { prisma } from "@dpf/db";

export type DiscoveryHealthSummary = {
  totalEntities: number;
  staleEntities: number;
  openIssues: number;
};

export function summarizeDiscoveryHealth(
  summary: DiscoveryHealthSummary,
): DiscoveryHealthSummary {
  return summary;
}

export async function getLatestDiscoveryRun() {
  return prisma.discoveryRun.findFirst({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      runKey: true,
      status: true,
      trigger: true,
      startedAt: true,
      completedAt: true,
      itemCount: true,
      relationshipCount: true,
    },
  });
}

export async function getInventoryEntitiesForPage() {
  return prisma.inventoryEntity.findMany({
    orderBy: [{ providerView: "asc" }, { name: "asc" }],
    include: {
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
      digitalProduct: { select: { id: true, productId: true, name: true } },
    },
  });
}

export async function getNeedsReviewEntities() {
  const entities = await prisma.inventoryEntity.findMany({
    where: { attributionStatus: "needs_review" },
    orderBy: [{ lastSeenAt: "desc" }],
    select: {
      id: true,
      entityKey: true,
      entityType: true,
      name: true,
      attributionConfidence: true,
      candidateTaxonomy: true,
      firstSeenAt: true,
      lastSeenAt: true,
      properties: true,
    },
  });
  return entities.map((e) => ({
    ...e,
    firstSeenAt: e.firstSeenAt.toISOString(),
    lastSeenAt: e.lastSeenAt.toISOString(),
    candidateTaxonomy: Array.isArray(e.candidateTaxonomy)
      ? (e.candidateTaxonomy as Array<{ nodeId: string; name: string; score: number }>)
      : [],
    properties: (e.properties ?? {}) as Record<string, unknown>,
  }));
}

export type DiscoveryTriageDecisionSummary = {
  id: string;
  decisionId: string;
  outcome: string;
  actorType: string;
  actorId: string | null;
  identityConfidence: number | null;
  taxonomyConfidence: number | null;
  evidenceCompleteness: number | null;
  reproducibilityScore: number | null;
  requiresHumanReview: boolean;
  createdAt: string;
  evidencePacket: Record<string, unknown>;
  proposedRule: Record<string, unknown> | null;
};

export type DiscoveryTriageQueueRow = Awaited<ReturnType<typeof getNeedsReviewEntities>>[number] & {
  latestDecision: DiscoveryTriageDecisionSummary | null;
};

export type DiscoveryTriageQueues = {
  autoAttributed: DiscoveryTriageQueueRow[];
  humanReview: DiscoveryTriageQueueRow[];
  needsMoreEvidence: DiscoveryTriageQueueRow[];
  taxonomyGaps: DiscoveryTriageQueueRow[];
  metrics: {
    total: number;
    withDecision: number;
  };
};

function normalizeDecision(decision: {
  id: string;
  decisionId: string;
  outcome: string;
  actorType: string;
  actorId: string | null;
  identityConfidence: number | null;
  taxonomyConfidence: number | null;
  evidenceCompleteness: number | null;
  reproducibilityScore: number | null;
  requiresHumanReview: boolean;
  createdAt: Date;
  evidencePacket: unknown;
  proposedRule: unknown;
}): DiscoveryTriageDecisionSummary {
  return {
    ...decision,
    createdAt: decision.createdAt.toISOString(),
    evidencePacket: (decision.evidencePacket ?? {}) as Record<string, unknown>,
    proposedRule: decision.proposedRule ? (decision.proposedRule as Record<string, unknown>) : null,
  };
}

export async function getInventoryTriageQueues(): Promise<DiscoveryTriageQueues> {
  const entities = await getNeedsReviewEntities();
  const entityIds = entities.map((entity) => entity.id);

  if (entityIds.length === 0) {
    return {
      autoAttributed: [],
      humanReview: [],
      needsMoreEvidence: [],
      taxonomyGaps: [],
      metrics: { total: 0, withDecision: 0 },
    };
  }

  const decisions = await prisma.discoveryTriageDecision.findMany({
    where: {
      inventoryEntityId: { in: entityIds },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      decisionId: true,
      inventoryEntityId: true,
      outcome: true,
      actorType: true,
      actorId: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      evidenceCompleteness: true,
      reproducibilityScore: true,
      requiresHumanReview: true,
      createdAt: true,
      evidencePacket: true,
      proposedRule: true,
    },
  });

  const latestDecisionByEntityId = new Map<string, DiscoveryTriageDecisionSummary>();
  for (const decision of decisions) {
    if (!decision.inventoryEntityId || latestDecisionByEntityId.has(decision.inventoryEntityId)) {
      continue;
    }
    latestDecisionByEntityId.set(decision.inventoryEntityId, normalizeDecision(decision));
  }

  const queues: DiscoveryTriageQueues = {
    autoAttributed: [],
    humanReview: [],
    needsMoreEvidence: [],
    taxonomyGaps: [],
    metrics: {
      total: entities.length,
      withDecision: latestDecisionByEntityId.size,
    },
  };

  for (const entity of entities) {
    const row: DiscoveryTriageQueueRow = {
      ...entity,
      latestDecision: latestDecisionByEntityId.get(entity.id) ?? null,
    };

    switch (row.latestDecision?.outcome) {
      case "auto-attributed":
        queues.autoAttributed.push(row);
        break;
      case "needs-more-evidence":
        queues.needsMoreEvidence.push(row);
        break;
      case "taxonomy-gap":
        queues.taxonomyGaps.push(row);
        break;
      default:
        queues.humanReview.push(row);
        break;
    }
  }

  return queues;
}

export async function getDiscoveryTriageDecisionHistory(
  inventoryEntityId: string,
): Promise<DiscoveryTriageDecisionSummary[]> {
  const decisions = await prisma.discoveryTriageDecision.findMany({
    where: { inventoryEntityId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      decisionId: true,
      outcome: true,
      actorType: true,
      actorId: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      evidenceCompleteness: true,
      reproducibilityScore: true,
      requiresHumanReview: true,
      createdAt: true,
      evidencePacket: true,
      proposedRule: true,
    },
  });

  return decisions.map(normalizeDecision);
}

// ─── Subnet-Grouped Inventory ────────────────────────────────────────────────

export type SubnetGroupEntity = {
  id: string;
  entityKey: string;
  name: string;
  entityType: string;
  status: string;
  attributionStatus: string;
  properties: Record<string, unknown>;
  portfolio: { slug: string; name: string } | null;
  taxonomyNode: { nodeId: string; name: string } | null;
  digitalProduct: { id: string; productId: string; name: string } | null;
};

export type SubnetGroup = {
  subnet: {
    id: string;
    name: string;
    entityType: string;
    networkAddress: string;
    isDocker: boolean;
  };
  entities: SubnetGroupEntity[];
  deviceCount: number;
  clientCount: number;
};

export type GroupedInventory = {
  physicalSubnets: SubnetGroup[];
  dockerSubnets: SubnetGroup[];
  ungrouped: SubnetGroupEntity[];
  totalCount: number;
};

export async function getInventoryEntitiesGroupedBySubnet(): Promise<GroupedInventory> {
  const [entities, memberOfRels] = await Promise.all([
    prisma.inventoryEntity.findMany({
      where: { status: "active" },
      orderBy: [{ entityType: "asc" }, { name: "asc" }],
      include: {
        portfolio: { select: { slug: true, name: true } },
        taxonomyNode: { select: { nodeId: true, name: true } },
        digitalProduct: { select: { id: true, productId: true, name: true } },
      },
    }),
    prisma.inventoryRelationship.findMany({
      where: { relationshipType: "MEMBER_OF", status: "active" },
      select: { fromEntityId: true, toEntityId: true },
    }),
  ]);

  // Map entity IDs to entities
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Find subnet/vlan entities
  const subnetEntities = entities.filter(
    (e) => e.entityType === "subnet" || e.entityType === "vlan",
  );

  // Build subnet -> member entity list
  const subnetMembers = new Map<string, SubnetGroupEntity[]>();
  const assignedEntityIds = new Set<string>();

  for (const rel of memberOfRels) {
    const toEntity = entityById.get(rel.toEntityId);
    const fromEntity = entityById.get(rel.fromEntityId);
    if (!toEntity || !fromEntity) continue;
    if (toEntity.entityType !== "subnet" && toEntity.entityType !== "vlan") continue;

    const members = subnetMembers.get(toEntity.id) ?? [];
    members.push({
      ...fromEntity,
      properties: (fromEntity.properties ?? {}) as Record<string, unknown>,
    });
    subnetMembers.set(toEntity.id, members);
    assignedEntityIds.add(fromEntity.id);
  }

  // Also assign infrastructure devices (router, switch, AP) to their subnet
  // by IP address matching if not already assigned via MEMBER_OF
  const subnetRanges = subnetEntities
    .filter((s) => s.entityType === "subnet")
    .map((s) => {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const addr = (props.networkAddress as string) ?? (props.network as string) ?? "";
      const parts = addr.split("/");
      return { id: s.id, network: parts[0] ?? "", cidr: Number(parts[1] ?? 0) };
    })
    .filter((s) => s.network && s.cidr > 0);

  for (const entity of entities) {
    if (assignedEntityIds.has(entity.id)) continue;
    if (entity.entityType === "subnet" || entity.entityType === "vlan") continue;
    const props = (entity.properties ?? {}) as Record<string, unknown>;
    const addr = (props.address as string) ?? (props.networkAddress as string) ?? "";
    if (!addr || addr.includes("/")) continue;

    for (const sr of subnetRanges) {
      if (isIpInSubnet(addr, sr.network, sr.cidr)) {
        const members = subnetMembers.get(sr.id) ?? [];
        members.push({
          ...entity,
          properties: (entity.properties ?? {}) as Record<string, unknown>,
        });
        subnetMembers.set(sr.id, members);
        assignedEntityIds.add(entity.id);
        break;
      }
    }
  }

  // Build groups
  const physicalSubnets: SubnetGroup[] = [];
  const dockerSubnets: SubnetGroup[] = [];

  for (const subnet of subnetEntities) {
    const props = (subnet.properties ?? {}) as Record<string, unknown>;
    const networkAddress = (props.networkAddress as string) ?? subnet.name;
    const isDocker = subnet.name.startsWith("Docker:") || networkAddress.startsWith("172.");

    const members = subnetMembers.get(subnet.id) ?? [];
    const group: SubnetGroup = {
      subnet: {
        id: subnet.id,
        name: subnet.name,
        entityType: subnet.entityType,
        networkAddress,
        isDocker,
      },
      entities: members,
      deviceCount: members.filter((e) =>
        ["router", "switch", "access_point", "gateway", "host", "docker_host", "container"].includes(e.entityType),
      ).length,
      clientCount: members.filter((e) => e.entityType === "network_client").length,
    };

    if (isDocker) {
      dockerSubnets.push(group);
    } else {
      physicalSubnets.push(group);
    }
  }

  // Sort: largest groups first
  physicalSubnets.sort((a, b) => b.entities.length - a.entities.length);
  dockerSubnets.sort((a, b) => b.entities.length - a.entities.length);

  // Ungrouped: entities not assigned to any subnet (excluding subnet/vlan entities themselves)
  const ungrouped = entities
    .filter(
      (e) =>
        !assignedEntityIds.has(e.id) &&
        e.entityType !== "subnet" &&
        e.entityType !== "vlan",
    )
    .map((e) => ({
      ...e,
      properties: (e.properties ?? {}) as Record<string, unknown>,
    }));

  return {
    physicalSubnets,
    dockerSubnets,
    ungrouped,
    totalCount: entities.length,
  };
}

function isIpInSubnet(ip: string, network: string, cidr: number): boolean {
  const ipNum = ip.split(".").reduce((n, o) => (n << 8) | Number(o), 0) >>> 0;
  const netNum = network.split(".").reduce((n, o) => (n << 8) | Number(o), 0) >>> 0;
  const mask = cidr === 0 ? 0 : ((0xffffffff << (32 - cidr)) >>> 0);
  return (ipNum & mask) === (netNum & mask);
}

export async function getOpenPortfolioQualityIssues() {
  return prisma.portfolioQualityIssue.findMany({
    where: { status: "open" },
    orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
    include: {
      inventoryEntity: { select: { entityKey: true, name: true } },
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
      digitalProduct: { select: { productId: true, name: true } },
    },
  });
}
