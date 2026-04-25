import { describe, expect, it, vi } from "vitest";

import {
  maybeTriggerDiscoveryTriageForVolume,
  runDiscoveryTriageDaily,
  runDiscoveryTriagePass,
} from "./discovery-triage-runner";

function createRunnerDb() {
  return {
    inventoryEntity: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    portfolioQualityIssue: {
      findMany: vi.fn(),
    },
    discoveryTriageDecision: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("runDiscoveryTriagePass", () => {
  it("auto-applies safe high-confidence matches and records the decision", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-1",
        entityKey: "service:docker:runtime",
        entityType: "service",
        name: "docker",
        firstSeenAt: new Date("2026-04-22T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T00:00:00Z"),
        manufacturer: "Docker",
        productModel: "Engine",
        attributionStatus: "needs_review",
        candidateTaxonomy: [
          {
            nodeId: "foundational/platform_services/container_platform",
            name: "Container Platform",
            score: 0.96,
          },
        ],
        properties: {
          processName: "dockerd",
          ports: [2375],
          softwareEvidence: ["docker-engine"],
        },
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db, {
      trigger: "cadence",
      actorId: "discovery-steward",
    });

    expect(db.inventoryEntity.update).toHaveBeenCalledWith({
      where: { id: "entity-1" },
      data: expect.objectContaining({
        taxonomyNodeId: "foundational/platform_services/container_platform",
        attributionStatus: "attributed",
        attributionMethod: "ai-proposed",
      }),
    });
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-1",
        actorType: "agent",
        actorId: "discovery-steward",
        outcome: "auto-attributed",
        requiresHumanReview: false,
      }),
    });
    expect(result.metrics.autoAttributed).toBe(1);
    expect(result.metrics.autoApplyRate).toBe(1);
    expect(result.metrics.decisionsCreated).toBe(1);
    expect(result.metrics.escalationQueueDepth).toBe(0);
  });

  it("routes ambiguous candidates to human review without auto-applying", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-2",
        entityKey: "service:ambiguous:edge",
        entityType: "service",
        name: "ambiguous-edge",
        firstSeenAt: new Date("2026-04-22T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T00:00:00Z"),
        attributionStatus: "needs_review",
        candidateTaxonomy: [
          {
            nodeId: "foundational/network_management/network_connectivity",
            name: "Network Connectivity",
            score: 0.91,
          },
          {
            nodeId: "foundational/network_management/network_security",
            name: "Network Security",
            score: 0.88,
          },
        ],
        properties: {
          processName: "edge-service",
          ports: [443],
          softwareEvidence: ["edge"],
        },
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([
      {
        id: "issue-2",
        issueType: "taxonomy_attribution_low_confidence",
        inventoryEntityId: "entity-2",
        summary: "Ambiguous candidate taxonomy",
      },
    ]);

    const result = await runDiscoveryTriagePass(db);

    expect(db.inventoryEntity.update).not.toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-2",
        qualityIssueId: "issue-2",
        outcome: "human-review",
        requiresHumanReview: true,
      }),
    });
    expect(result.metrics.humanReview).toBe(1);
    expect(result.metrics.escalationQueueDepth).toBe(1);
    expect(result.metrics.repeatUnresolved).toBe(1);
  });

  it("routes clear identity without a taxonomy node to taxonomy-gap", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-3",
        entityKey: "device:custom:edge-probe",
        entityType: "device",
        name: "edge-probe",
        firstSeenAt: new Date("2026-04-23T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T00:00:00Z"),
        confidence: 0.9,
        manufacturer: "Acme",
        productModel: "Probe",
        attributionStatus: "needs_review",
        candidateTaxonomy: [],
        properties: {
          processName: "edge-probe",
          softwareEvidence: ["acme-edge-probe"],
        },
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db);

    expect(db.inventoryEntity.update).not.toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-3",
        outcome: "taxonomy-gap",
        requiresHumanReview: true,
      }),
    });
    expect(result.metrics.taxonomyGap).toBe(1);
    expect(result.metrics.escalationQueueDepth).toBe(1);
  });

  it("returns needs-more-evidence for sparse unresolved entities", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-4",
        entityKey: "service:unknown",
        entityType: "service",
        name: "unknown",
        firstSeenAt: new Date("2026-04-25T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T00:15:00Z"),
        attributionStatus: "needs_review",
        candidateTaxonomy: [],
        properties: {},
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db);

    expect(db.inventoryEntity.update).not.toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-4",
        outcome: "needs-more-evidence",
        requiresHumanReview: false,
      }),
    });
    expect(result.metrics.needsMoreEvidence).toBe(1);
    expect(result.metrics.decisionsCreated).toBe(1);
  });

  it("skips duplicate daily runs when the same idempotency key already exists", async () => {
    const db = createRunnerDb();
    db.discoveryTriageDecision.findFirst.mockResolvedValue({
      decisionId: "triage-existing",
    });

    const result = await runDiscoveryTriageDaily(db, {
      trigger: "cadence",
      actorId: "discovery-steward",
      now: new Date("2026-04-25T13:00:00Z"),
    });

    expect(db.inventoryEntity.findMany).not.toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.runIdempotencyKey).toBe("2026-04-25:discovery-steward:cadence");
    expect(result.metrics.processed).toBe(0);
  });

  it("does not trigger volume triage below the threshold", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.count.mockResolvedValue(12);

    const result = await maybeTriggerDiscoveryTriageForVolume(db, {
      threshold: 25,
      actorId: "discovery-steward",
      now: new Date("2026-04-25T13:00:00Z"),
    });

    expect(db.discoveryTriageDecision.findFirst).not.toHaveBeenCalled();
    expect(db.inventoryEntity.findMany).not.toHaveBeenCalled();
    expect(result.triggered).toBe(false);
    expect(result.pendingCount).toBe(12);
  });

  it("triggers a volume run once the needs-review threshold is crossed", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.count.mockResolvedValue(30);
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-5",
        entityKey: "service:docker:runtime",
        entityType: "service",
        name: "docker",
        firstSeenAt: new Date("2026-04-22T00:00:00Z"),
        lastSeenAt: new Date("2026-04-25T00:00:00Z"),
        manufacturer: "Docker",
        productModel: "Engine",
        attributionStatus: "needs_review",
        candidateTaxonomy: [
          {
            nodeId: "foundational/platform_services/container_platform",
            name: "Container Platform",
            score: 0.96,
          },
        ],
        properties: {
          processName: "dockerd",
          ports: [2375],
          softwareEvidence: ["docker-engine"],
        },
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await maybeTriggerDiscoveryTriageForVolume(db, {
      threshold: 25,
      actorId: "discovery-steward",
      now: new Date("2026-04-25T13:00:00Z"),
    });

    expect(db.discoveryTriageDecision.findFirst).toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-5",
        outcome: "auto-attributed",
        evidencePacket: expect.objectContaining({
          runIdempotencyKey: "2026-04-25:discovery-steward:volume",
        }),
      }),
    });
    expect(result.triggered).toBe(true);
    expect(result.pendingCount).toBe(30);
    expect(result.result?.runIdempotencyKey).toBe("2026-04-25:discovery-steward:volume");
  });
});
