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
    taxonomyNode: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: "tax-client-compute" }),
    },
    discoveryTriageDecision: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    discoveryFingerprintObservation: {
      upsert: vi.fn().mockResolvedValue({ id: "fingerprint-observation-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    discoveryFingerprintReview: {
      create: vi.fn().mockResolvedValue({}),
    },
    discoveryFingerprintRule: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    platformConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    taskRun: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeAmbiguousEntity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    entityKey: `service:${id}`,
    entityType: "service",
    name: `ambiguous-${id}`,
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
        score: 0.89,
      },
    ],
    properties: {
      processName: "edge-service",
      ports: [443],
      softwareEvidence: ["edge"],
      secretToken: "must-not-egress",
    },
    ...overrides,
  };
}

describe("runDiscoveryTriagePass", () => {
  it("auto-applies safe high-confidence matches and records the decision", async () => {
    const db = createRunnerDb();
    db.taxonomyNode.findMany.mockResolvedValue([
      {
        id: "tax-node-container-platform",
        nodeId: "foundational/platform_services/container_platform",
      },
    ]);
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
      actorId: "inventory-specialist",
    });

    expect(db.inventoryEntity.update).toHaveBeenCalledWith({
      where: { id: "entity-1" },
      data: expect.objectContaining({
        taxonomyNodeId: "tax-node-container-platform",
        attributionStatus: "attributed",
        attributionMethod: "ai-proposed",
      }),
    });
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-1",
        actorType: "agent",
        actorId: "inventory-specialist",
        outcome: "auto-attributed",
        selectedTaxonomyNodeId: "tax-node-container-platform",
        requiresHumanReview: false,
        evidencePacket: expect.objectContaining({
          candidateTaxonomy: expect.arrayContaining([
            expect.objectContaining({
              nodeId: "foundational/platform_services/container_platform",
            }),
          ]),
        }),
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

  it("triages entities referenced by open quality issues even when their attribution status is not already queued", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      makeAmbiguousEntity("issue-backed-entity", {
        attributionStatus: "attributed",
        attributionConfidence: 0.97,
      }),
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([
      {
        id: "issue-backed-1",
        issueType: "name_not_promotable",
        inventoryEntityId: "issue-backed-entity",
        summary: "Name cannot be promoted without triage.",
      },
    ]);

    const result = await runDiscoveryTriagePass(db);

    expect(db.inventoryEntity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { id: { in: ["issue-backed-entity"] } },
        ]),
      }),
    }));
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "issue-backed-entity",
        qualityIssueId: "issue-backed-1",
      }),
    });
    expect(result.metrics.processed).toBe(1);
    expect(result.metrics.repeatUnresolved).toBe(1);
  });

  it("uses bounded review for ambiguous packets and records schema drops without blocking deterministic decisions", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      makeAmbiguousEntity("entity-review-1"),
      makeAmbiguousEntity("entity-review-2", {
        candidateTaxonomy: [],
        confidence: 0.3,
        properties: {},
      }),
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db, {
      enableAutonomousReview: true,
      autonomousReviewer: async () => [
        {
          inventoryEntityId: "entity-review-1",
          classification: "dismiss",
          confidence: "medium",
          rationale: "Repeated probe noise rather than a durable product signal.",
        },
        {
          inventoryEntityId: "entity-review-2",
          classification: "invented",
          confidence: "high",
          rationale: "Invalid classification should be dropped.",
        },
        {
          inventoryEntityId: "outside-batch",
          classification: "force_human_review",
          confidence: "high",
          rationale: "Valid shape but not part of this reviewed batch.",
        },
      ],
    });

    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-review-1",
        outcome: "dismissed",
        requiresHumanReview: false,
        evidencePacket: expect.objectContaining({
          boundedReview: expect.objectContaining({
            classification: "dismiss",
          }),
        }),
      }),
    });
    expect(result.metrics.reviewed).toBe(1);
    expect(result.metrics.reviewSchemaDropCount).toBe(2);
    expect(result.metrics.reviewParseSuccessRate).toBe(0.5);
    expect(result.metrics.reviewClassificationHistogram).toEqual({ dismiss: 1 });
  });

  it("sends only allowlisted public triage fields to the bounded reviewer", async () => {
    const db = createRunnerDb();
    let capturedInput: Record<string, unknown> | null = null;
    db.inventoryEntity.findMany.mockResolvedValue([makeAmbiguousEntity("entity-egress")]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    await runDiscoveryTriagePass(db, {
      enableAutonomousReview: true,
      autonomousReviewer: async (input) => {
        capturedInput = input as Record<string, unknown>;
        return [
          {
            inventoryEntityId: "entity-egress",
            classification: "force_human_review",
            confidence: "medium",
            rationale: "Ambiguous placement needs operator review.",
          },
        ];
      },
    });

    expect(capturedInput).not.toBeNull();
    const captured = capturedInput as unknown as Record<string, unknown>;
    expect(Object.keys(captured).sort()).toEqual(["allowedClassifications", "entities"].sort());
    const reviewedEntity = (captured["entities"] as Array<Record<string, unknown>>)[0];
    expect(reviewedEntity).toEqual(expect.objectContaining({
      inventoryEntityId: "entity-egress",
      proceduralOutcome: "human-review",
    }));
    expect(reviewedEntity).not.toHaveProperty("properties");
    expect(JSON.stringify(captured)).not.toContain("must-not-egress");
  });

  it("classifies reviewer failures and continues the procedural triage pass", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([makeAmbiguousEntity("entity-failure")]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db, {
      enableAutonomousReview: true,
      autonomousReviewer: async () => {
        throw new Error("provider rate limit exceeded");
      },
    });

    expect(result.metrics.reviewFailed).toBe(1);
    expect(result.metrics.reviewFailureReason).toBe("provider_rate_limit");
    expect(result.metrics.decisionsCreated).toBe(1);
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-failure",
        outcome: "human-review",
      }),
    });
  });

  it("honors the runtime review kill switch without skipping procedural triage", async () => {
    const db = createRunnerDb();
    let reviewerCalls = 0;
    db.platformConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === "discovery-triage.review.enabled" ? { value: false } : null,
    );
    db.inventoryEntity.findMany.mockResolvedValue([makeAmbiguousEntity("entity-disabled")]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    const result = await runDiscoveryTriagePass(db, {
      enableAutonomousReview: true,
      autonomousReviewer: async () => {
        reviewerCalls++;
        return [];
      },
    });

    expect(reviewerCalls).toBe(0);
    expect(result.metrics.reviewSkipReason).toBe("operator_disabled");
    expect(result.metrics.decisionsCreated).toBe(1);
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

  it("investigates needs-more-evidence device gaps through the coworker fingerprint loop", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.findMany.mockResolvedValue([
      {
        id: "entity-printer",
        entityKey: "organization:internal:host:arp:192.168.0.103",
        entityType: "host",
        name: "Printer",
        firstSeenAt: new Date("2026-07-22T00:00:00Z"),
        lastSeenAt: new Date("2026-07-23T08:00:00Z"),
        attributionStatus: "needs_review",
        candidateTaxonomy: [],
        properties: {
          vendor: "CHONGQING FUGUI ELECTRONICS CO.,LTD.",
          mac: "8c:c8:4b:d6:f1:35",
          hostname: "NPI698BC4",
          operatorName: "Printer",
        },
      },
    ]);
    db.portfolioQualityIssue.findMany.mockResolvedValue([]);

    await runDiscoveryTriagePass(db, {
      actorId: "inventory-specialist",
    });

    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-printer",
        outcome: "needs-more-evidence",
        requiresHumanReview: false,
      }),
    });
    expect(db.discoveryFingerprintObservation.upsert).toHaveBeenCalledWith({
      where: { observationKey: "triage:entity-printer:fingerprint" },
      create: expect.objectContaining({
        observationKey: "triage:entity-printer:fingerprint",
        inventoryEntityId: "entity-printer",
        sourceKind: "discovery-triage",
        signalClass: "device_identity_gap",
        decisionStatus: "pending_coworker_review",
      }),
      update: expect.objectContaining({
        inventoryEntityId: "entity-printer",
        sourceKind: "discovery-triage",
        signalClass: "device_identity_gap",
        decisionStatus: "pending_coworker_review",
      }),
    });
    expect(db.discoveryFingerprintReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observationId: "fingerprint-observation-1",
        reviewerType: "coworker",
        reviewerId: "inventory-specialist",
        decision: "draft_authored",
        nextStatus: "draft",
      }),
    });
    expect(db.discoveryFingerprintRule.upsert).toHaveBeenCalledWith({
      where: expect.any(Object),
      update: expect.objectContaining({
        status: "draft",
        resolvedIdentity: expect.objectContaining({ deviceClass: "printer" }),
        taxonomyNodeId: "tax-client-compute",
      }),
      create: expect.objectContaining({
        status: "draft",
        resolvedIdentity: expect.objectContaining({ deviceClass: "printer" }),
        taxonomyNodeId: "tax-client-compute",
      }),
    });
    expect(db.discoveryFingerprintObservation.update).toHaveBeenCalledWith({
      where: { id: "fingerprint-observation-1" },
      data: expect.objectContaining({
        decisionStatus: "draft",
        reviewReason: expect.stringContaining("Recognised observed signal"),
      }),
    });
  });

  it("skips duplicate daily runs when the same idempotency key already exists", async () => {
    const db = createRunnerDb();
    db.discoveryTriageDecision.findFirst.mockResolvedValue({
      decisionId: "triage-existing",
    });

    const result = await runDiscoveryTriageDaily(db, {
      trigger: "cadence",
      actorId: "inventory-specialist",
      now: new Date("2026-04-25T13:00:00Z"),
    });

    expect(db.inventoryEntity.findMany).not.toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.runIdempotencyKey).toBe("2026-04-25:inventory-specialist:cadence");
    expect(result.metrics.processed).toBe(0);
  });

  it("does not trigger volume triage below the threshold", async () => {
    const db = createRunnerDb();
    db.inventoryEntity.count.mockResolvedValue(12);

    const result = await maybeTriggerDiscoveryTriageForVolume(db, {
      threshold: 25,
      actorId: "inventory-specialist",
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
      actorId: "inventory-specialist",
      now: new Date("2026-04-25T13:00:00Z"),
    });

    expect(db.discoveryTriageDecision.findFirst).toHaveBeenCalled();
    expect(db.discoveryTriageDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryEntityId: "entity-5",
        outcome: "auto-attributed",
        evidencePacket: expect.objectContaining({
          runIdempotencyKey: "2026-04-25:inventory-specialist:volume",
        }),
      }),
    });
    expect(result.triggered).toBe(true);
    expect(result.pendingCount).toBe(30);
    expect(result.result?.runIdempotencyKey).toBe("2026-04-25:inventory-specialist:volume");
  });
});
