import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    inventoryEntity: {
      findMany: vi.fn(),
    },
    discoveryTriageDecision: {
      findMany: vi.fn(),
    },
    discoveryRun: {
      findFirst: vi.fn(),
    },
    inventoryRelationship: {
      findMany: vi.fn(),
    },
    portfolioQualityIssue: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  getDiscoveryTriageDecisionHistory,
  getInventoryTriageQueues,
  summarizeDiscoveryHealth,
} from "./discovery-data";

const mockPrisma = prisma as unknown as {
  inventoryEntity: { findMany: ReturnType<typeof vi.fn> };
  discoveryTriageDecision: { findMany: ReturnType<typeof vi.fn> };
};

describe("summarizeDiscoveryHealth", () => {
  it("summarizes inventory freshness and unresolved quality issues", () => {
    expect(summarizeDiscoveryHealth({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    })).toEqual({
      totalEntities: 12,
      staleEntities: 2,
      openIssues: 3,
    });
  });
});

describe("discovery triage queues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups needs-review entities by their latest triage decision outcome", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-1",
        entityKey: "service:one",
        entityType: "service",
        name: "Entity One",
        attributionConfidence: 0.32,
        candidateTaxonomy: [],
        firstSeenAt: new Date("2026-04-25T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T01:00:00Z"),
        properties: {},
      },
      {
        id: "entity-2",
        entityKey: "service:two",
        entityType: "service",
        name: "Entity Two",
        attributionConfidence: 0.91,
        candidateTaxonomy: [],
        firstSeenAt: new Date("2026-04-25T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T01:00:00Z"),
        properties: {},
      },
      {
        id: "entity-3",
        entityKey: "service:three",
        entityType: "service",
        name: "Entity Three",
        attributionConfidence: 0.72,
        candidateTaxonomy: [],
        firstSeenAt: new Date("2026-04-25T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T01:00:00Z"),
        properties: {},
      },
    ]);

    mockPrisma.discoveryTriageDecision.findMany.mockResolvedValue([
      {
        id: "decision-1",
        decisionId: "triage-1",
        inventoryEntityId: "entity-1",
        outcome: "needs-more-evidence",
        actorType: "agent",
        actorId: "discovery-steward",
        identityConfidence: 0.45,
        taxonomyConfidence: 0.12,
        evidenceCompleteness: 0.4,
        reproducibilityScore: 0.35,
        requiresHumanReview: false,
        createdAt: new Date("2026-04-25T02:00:00Z"),
        evidencePacket: { key: "one" },
        proposedRule: null,
      },
      {
        id: "decision-2",
        decisionId: "triage-2",
        inventoryEntityId: "entity-2",
        outcome: "auto-attributed",
        actorType: "agent",
        actorId: "discovery-steward",
        identityConfidence: 0.93,
        taxonomyConfidence: 0.92,
        evidenceCompleteness: 0.9,
        reproducibilityScore: 0.9,
        requiresHumanReview: false,
        createdAt: new Date("2026-04-25T02:10:00Z"),
        evidencePacket: { key: "two" },
        proposedRule: { ruleType: "discovery-fingerprint" },
      },
      {
        id: "decision-3",
        decisionId: "triage-3",
        inventoryEntityId: "entity-3",
        outcome: "taxonomy-gap",
        actorType: "agent",
        actorId: "discovery-steward",
        identityConfidence: 0.88,
        taxonomyConfidence: 0,
        evidenceCompleteness: 0.9,
        reproducibilityScore: 0.8,
        requiresHumanReview: true,
        createdAt: new Date("2026-04-25T02:20:00Z"),
        evidencePacket: { key: "three" },
        proposedRule: null,
      },
    ]);

    const result = await getInventoryTriageQueues();

    expect(result.metrics).toEqual({ total: 3, withDecision: 3 });
    expect(result.autoAttributed.map((row) => row.id)).toEqual(["entity-2"]);
    expect(result.needsMoreEvidence.map((row) => row.id)).toEqual(["entity-1"]);
    expect(result.taxonomyGaps.map((row) => row.id)).toEqual(["entity-3"]);
    expect(result.humanReview).toEqual([]);
  });

  it("defaults entities with no triage decision into the human review queue", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-4",
        entityKey: "service:four",
        entityType: "service",
        name: "Entity Four",
        attributionConfidence: 0.5,
        candidateTaxonomy: [],
        firstSeenAt: new Date("2026-04-25T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T01:00:00Z"),
        properties: {},
      },
    ]);
    mockPrisma.discoveryTriageDecision.findMany.mockResolvedValue([]);

    const result = await getInventoryTriageQueues();

    expect(result.humanReview).toHaveLength(1);
    expect(result.humanReview[0]?.latestDecision).toBeNull();
  });

  it("returns descending decision history for an entity", async () => {
    mockPrisma.discoveryTriageDecision.findMany.mockResolvedValue([
      {
        id: "decision-5",
        decisionId: "triage-5",
        outcome: "human-review",
        actorType: "human",
        actorId: "user-1",
        identityConfidence: 0.8,
        taxonomyConfidence: 0.7,
        evidenceCompleteness: 0.8,
        reproducibilityScore: 0.7,
        requiresHumanReview: true,
        createdAt: new Date("2026-04-25T05:00:00Z"),
        evidencePacket: { key: "history" },
        proposedRule: null,
      },
    ]);

    const result = await getDiscoveryTriageDecisionHistory("entity-5");

    expect(mockPrisma.discoveryTriageDecision.findMany).toHaveBeenCalledWith({
      where: { inventoryEntityId: "entity-5" },
      orderBy: [{ createdAt: "desc" }],
      select: expect.any(Object),
    });
    expect(result[0]).toMatchObject({
      decisionId: "triage-5",
      outcome: "human-review",
      createdAt: "2026-04-25T05:00:00.000Z",
    });
  });
});
