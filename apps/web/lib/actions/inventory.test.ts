import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    inventoryEntity: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    portfolio: {
      findUnique: vi.fn(),
    },
    discoveryTriageDecision: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    portfolioQualityIssue: {
      findUnique: vi.fn(),
    },
  },
  promoteInventoryEntities: vi.fn(),
}));
vi.mock("@dpf/db/discovery-triage", () => ({
  buildDiscoveryEvidencePacket: vi.fn(),
  scoreDiscoveryTriageCandidate: vi.fn(),
  recordDiscoveryTriageDecision: vi.fn(),
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS: {
    deterministicAutoApply: 0.95,
    coworkerAutoApply: 0.9,
    taxonomyGapIdentity: 0.85,
    humanReviewFloor: 0.6,
    ambiguityMargin: 0.05,
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { prisma, promoteInventoryEntities } from "@dpf/db";
import {
  buildDiscoveryEvidencePacket,
  recordDiscoveryTriageDecision,
  scoreDiscoveryTriageCandidate,
} from "@dpf/db/discovery-triage";
import {
  acceptAttribution,
  acceptTriageRecommendation,
  dismissEntity,
  markTaxonomyGapForReview,
  reassignTaxonomy,
  requestDiscoveryEvidence,
} from "./inventory";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockPromoteInventoryEntities = promoteInventoryEntities as ReturnType<typeof vi.fn>;
const mockBuildDiscoveryEvidencePacket = buildDiscoveryEvidencePacket as ReturnType<typeof vi.fn>;
const mockScoreDiscoveryTriageCandidate = scoreDiscoveryTriageCandidate as ReturnType<typeof vi.fn>;
const mockRecordDiscoveryTriageDecision = recordDiscoveryTriageDecision as ReturnType<typeof vi.fn>;
const mockDiscoveryTriageDecisionFindFirst = prisma.discoveryTriageDecision.findFirst as ReturnType<typeof vi.fn>;
const mockDiscoveryTriageDecisionFindUnique = prisma.discoveryTriageDecision.findUnique as ReturnType<typeof vi.fn>;
const mockDiscoveryTriageDecisionCreate = prisma.discoveryTriageDecision.create as ReturnType<typeof vi.fn>;
const mockDiscoveryTriageDecisionUpdate = prisma.discoveryTriageDecision.update as ReturnType<typeof vi.fn>;
const mockInventoryEntityUpdate = prisma.inventoryEntity.update as ReturnType<typeof vi.fn>;
const mockInventoryEntityFindUnique = prisma.inventoryEntity.findUnique as ReturnType<typeof vi.fn>;
const mockTaxonomyNodeFindFirst = prisma.taxonomyNode.findFirst as ReturnType<typeof vi.fn>;
const mockPortfolioFindUnique = prisma.portfolio.findUnique as ReturnType<typeof vi.fn>;
const baseScore = {
  identityConfidence: 0.92,
  taxonomyConfidence: 0.91,
  evidenceCompleteness: 0.88,
  reproducibilityScore: 0.84,
  identityAmbiguityMargin: 0.32,
  taxonomyAmbiguityMargin: 0.29,
};
const basePacket = {
  inventoryEntity: {
    id: "entity-1",
    entityKey: "service:mystery-engine",
    entityType: "service",
    name: "Mystery Engine",
  },
  candidateTaxonomy: [{ nodeId: "foundational/compute/servers", score: 0.91 }],
  identityCandidates: [{ identity: "Mystery Engine", score: 0.92 }],
  protocolEvidence: { prometheusLabels: { job: "mystery-engine" } },
  redactionStatus: "unverified",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildDiscoveryEvidencePacket.mockReturnValue(basePacket);
  mockScoreDiscoveryTriageCandidate.mockReturnValue(baseScore);
  mockRecordDiscoveryTriageDecision.mockResolvedValue({ id: "triage-mock" });
});

describe("inventory actions", () => {
  it("denies attribution changes when the user lacks discovery management rights", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-300", isSuperuser: false },
    });
    mockCan.mockReturnValue(false);

    await expect(acceptAttribution("entity-1")).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("revalidates discovery surfaces after accepting attribution", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityUpdate.mockResolvedValue({});
    mockPromoteInventoryEntities.mockResolvedValue({});

    await expect(acceptAttribution("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("revalidates discovery surfaces after manual taxonomy reassignment", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockTaxonomyNodeFindFirst.mockResolvedValue({ id: "tax-1", nodeId: "foundational/network/wifi" });
    mockPortfolioFindUnique.mockResolvedValue({ id: "portfolio-1" });
    mockInventoryEntityUpdate.mockResolvedValue({});
    mockPromoteInventoryEntities.mockResolvedValue({});

    await expect(reassignTaxonomy("entity-1", "tax-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("revalidates discovery surfaces after dismissing an entity", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityUpdate.mockResolvedValue({});

    await expect(dismissEntity("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("records a needs-more-evidence decision when a human requests more discovery evidence", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityFindUnique.mockResolvedValue({
      id: "entity-1",
      entityKey: "service:mystery-engine",
      entityType: "service",
      name: "Mystery Engine",
      providerView: "foundational",
      manufacturer: null,
      productModel: null,
      observedVersion: null,
      normalizedVersion: null,
      firstSeenAt: new Date("2026-04-25T12:00:00Z"),
      lastSeenAt: new Date("2026-04-25T13:00:00Z"),
      attributionConfidence: 0.44,
      attributionEvidence: null,
      candidateTaxonomy: [{ nodeId: "foundational/compute/servers", score: 0.44 }],
      properties: { job: "mystery-engine" },
    });
    mockDiscoveryTriageDecisionFindFirst.mockResolvedValue(null);
    mockDiscoveryTriageDecisionCreate.mockResolvedValue({ id: "triage-1" });

    await expect(requestDiscoveryEvidence("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRecordDiscoveryTriageDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inventoryEntityId: "entity-1",
        actorType: "human",
        actorId: "user-1",
        outcome: "needs-more-evidence",
        requiresHumanReview: false,
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("records a taxonomy-gap decision that stays in human review", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockInventoryEntityFindUnique.mockResolvedValue({
      id: "entity-1",
      entityKey: "device:unknown",
      entityType: "device",
      name: "Unknown Device",
      providerView: "foundational",
      manufacturer: "Contoso",
      productModel: "X1000",
      observedVersion: null,
      normalizedVersion: null,
      firstSeenAt: new Date("2026-04-25T12:00:00Z"),
      lastSeenAt: new Date("2026-04-25T13:00:00Z"),
      attributionConfidence: 0.52,
      attributionEvidence: null,
      candidateTaxonomy: [],
      properties: { sysName: "unknown-device" },
    });
    mockDiscoveryTriageDecisionFindFirst.mockResolvedValue(null);
    mockDiscoveryTriageDecisionCreate.mockResolvedValue({ id: "triage-2" });

    await expect(markTaxonomyGapForReview("entity-1")).resolves.toEqual({ ok: true });

    expect(mockRecordDiscoveryTriageDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inventoryEntityId: "entity-1",
        outcome: "taxonomy-gap",
        requiresHumanReview: true,
      }),
    );
  });

  it("accepts a triage recommendation, keeps the original decision, and revalidates discovery surfaces", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockDiscoveryTriageDecisionFindUnique.mockResolvedValue({
      id: "decision-row-1",
      decisionId: "decision-1",
      inventoryEntityId: "entity-1",
      selectedTaxonomyNodeId: "foundational/compute/servers",
      selectedIdentity: { label: "Mystery Engine" },
      identityConfidence: 0.92,
      taxonomyConfidence: 0.91,
      evidenceCompleteness: 0.88,
      reproducibilityScore: 0.84,
      evidencePacket: basePacket,
      proposedRule: {
        ruleType: "discovery-fingerprint",
        taxonomyNodeId: "foundational/compute/servers",
      },
      requiresHumanReview: true,
    });
    mockTaxonomyNodeFindFirst.mockResolvedValue({
      id: "taxonomy-1",
      nodeId: "foundational/compute/servers",
    });
    mockPortfolioFindUnique.mockResolvedValue({ id: "portfolio-1" });
    mockInventoryEntityUpdate.mockResolvedValue({});
    mockDiscoveryTriageDecisionUpdate.mockResolvedValue({});
    mockDiscoveryTriageDecisionCreate.mockResolvedValue({ id: "decision-row-2" });
    mockPromoteInventoryEntities.mockResolvedValue({});

    await expect(acceptTriageRecommendation("decision-1")).resolves.toEqual({ ok: true });

    expect(mockDiscoveryTriageDecisionUpdate).toHaveBeenCalledWith({
      where: { decisionId: "decision-1" },
      data: expect.objectContaining({
        humanReviewedAt: expect.any(Date),
      }),
    });
    expect(mockInventoryEntityUpdate).toHaveBeenCalledWith({
      where: { id: "entity-1" },
      data: expect.objectContaining({
        taxonomyNodeId: "taxonomy-1",
        attributionStatus: "attributed",
        attributionMethod: "ai-proposed",
      }),
    });
    expect(mockRecordDiscoveryTriageDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inventoryEntityId: "entity-1",
        outcome: "auto-attributed",
        requiresHumanReview: false,
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
  });
});
