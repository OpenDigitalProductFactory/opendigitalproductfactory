import { beforeEach, describe, expect, it, vi } from "vitest";

const { createEvidence, updateEvidence } = vi.hoisted(() => ({
  createEvidence: vi.fn().mockResolvedValue({ id: "evidence-db-new" }),
  updateEvidence: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    complianceEvidence: {
      create: createEvidence,
      updateMany: updateEvidence,
    },
  },
}));

import type { ProviderConnectionPosture, ProviderSuitabilityPolicy } from "./types";
import {
  buildProviderSuitabilityRouteReceipt,
  recordProviderTrustEvidence,
  resolveProviderTrustEvidence,
  supersedeProviderTrustEvidenceClaim,
  type ProviderTrustEvidenceRecord,
} from "./evidence";

const NOW = new Date("2026-07-20T09:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  createEvidence.mockResolvedValue({ id: "evidence-db-new" });
  updateEvidence.mockResolvedValue({ count: 1 });
});

function connection(overrides: Partial<ProviderConnectionPosture> = {}): ProviderConnectionPosture {
  return {
    providerConnectionId: "connection-enterprise",
    providerId: "anthropic",
    executionChannel: "direct-api",
    accountClass: "enterprise",
    commercialBasis: "enterprise-contract",
    authMethod: "api-key",
    contractEvidence: {
      supplierContractId: "contract-enterprise",
      baaOnFile: true,
      dpaOnFile: true,
    },
    entitlements: {
      noTraining: true,
      zeroRetention: true,
      enabledRegions: ["eu"],
    },
    evidenceStatus: "contract-uploaded",
    lastReviewedAt: "2026-06-20T09:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides: Partial<ProviderTrustEvidenceRecord> = {}): ProviderTrustEvidenceRecord {
  return {
    evidenceId: "evidence-no-training",
    providerConnectionId: "connection-enterprise",
    evidenceType: "provider-contract",
    claimKey: "no-training",
    assertedValue: true,
    status: "active",
    collectedAt: new Date("2026-06-20T09:00:00.000Z"),
    validFrom: null,
    expiresAt: new Date("2027-06-20T09:00:00.000Z"),
    supersededById: null,
    ...overrides,
  };
}

describe("resolveProviderTrustEvidence", () => {
  it("accepts current connection-bound evidence and reports its age", () => {
    const result = resolveProviderTrustEvidence({
      connection: connection(),
      records: [evidence()],
      now: NOW,
    });

    expect(result.claims).toEqual([
      expect.objectContaining({ claimKey: "no-training", status: "valid", evidenceAgeDays: 30 }),
    ]);
    expect(result.posture.entitlements.noTraining).toBe(true);
    expect(result.posture.evidenceStatus).toBe("contract-uploaded");
  });

  it.each([
    ["missing", [], "Add evidence for this connected account."],
    ["expired", [evidence({ expiresAt: new Date("2026-07-19T09:00:00.000Z") })], "Renew or replace the expired evidence."],
    ["rejected", [evidence({ status: "rejected" })], "Resolve the rejected evidence before restricted routing."],
    ["superseded", [evidence({ status: "superseded", supersededById: "new-evidence" })], "Link the current replacement evidence."],
  ] as const)("reports %s evidence without preserving the asserted entitlement", (status, records, nextAction) => {
    const result = resolveProviderTrustEvidence({
      connection: connection(),
      records: [...records],
      now: NOW,
      requiredClaims: ["no-training"],
    });

    expect(result.claims[0]).toEqual(expect.objectContaining({ status, nextAction }));
    expect(result.posture.entitlements.noTraining).toBeUndefined();
  });

  it("treats simultaneously current contradictory assertions as conflicting", () => {
    const result = resolveProviderTrustEvidence({
      connection: connection(),
      records: [evidence(), evidence({ evidenceId: "evidence-training-allowed", assertedValue: false })],
      now: NOW,
    });

    expect(result.claims[0]).toEqual(expect.objectContaining({ status: "conflicting" }));
    expect(result.posture.entitlements.noTraining).toBeUndefined();
    expect(result.posture.evidenceStatus).toBe("rejected");
  });

  it("never transfers evidence from another account or tenant for the same provider", () => {
    const regular = resolveProviderTrustEvidence({
      connection: connection({
        providerConnectionId: "connection-regular",
        accountClass: "regular",
        commercialBasis: "usage-metered",
        contractEvidence: {},
        entitlements: {},
        evidenceStatus: "unreviewed",
      }),
      records: [evidence()],
      now: NOW,
      requiredClaims: ["no-training"],
    });

    expect(regular.claims[0]?.status).toBe("missing");
    expect(regular.posture.entitlements.noTraining).toBeUndefined();
    expect(regular.posture.contractEvidence.supplierContractId).toBeUndefined();
  });

  it("drops a future-dated assertion until its validity window begins", () => {
    const result = resolveProviderTrustEvidence({
      connection: connection(),
      records: [evidence({ validFrom: new Date("2026-08-01T00:00:00.000Z") })],
      now: NOW,
    });

    expect(result.claims[0]?.status).toBe("missing");
    expect(result.posture.entitlements.noTraining).toBeUndefined();
  });
});

describe("buildProviderSuitabilityRouteReceipt", () => {
  const policy: ProviderSuitabilityPolicy = {
    policyId: "policy-sha256",
    organizationId: "organization-sensitive-id",
    source: "admin",
    effect: "review",
    allowedProviders: ["anthropic"],
    deniedProviders: ["personal-provider"],
    allowedProviderConnectionIds: ["connection-enterprise"],
    deniedProviderConnectionIds: ["connection-personal"],
    residencyPolicy: "approved_cloud",
    openRouterObligations: {
      requireProviderAllowlist: true,
      requireProviderBlocklist: false,
      requireZdr: true,
      denyDataCollection: true,
      requireBoundedFallbacks: true,
      requiredRegion: "eu",
      approvedEndpointSlugs: ["anthropic/eu"],
      providerConnectionId: "connection-enterprise",
      accountClass: "enterprise",
      evidenceStatus: "contract-uploaded",
      regionalProcessingEntitled: true,
      enabledRegions: ["eu"],
      requiredBaseUrl: "https://eu.openrouter.ai/api/v1",
    },
    explanations: [
      { code: "provider-evidence-required", message: "Sensitive explanation", providerConnectionId: "connection-personal" },
    ],
    compilerVersion: "provider-suitability/v1",
  };

  it("captures policy versions, channel posture, provider identity, exclusions, obligations, and codes", () => {
    const receipt = buildProviderSuitabilityRouteReceipt({
      policy,
      inputVersion: "work-context/v1",
      connection: connection(),
      selectedProviderId: "openrouter",
      selectedUnderlyingProviderId: "anthropic",
      excludedProviderIds: ["personal-provider"],
      createdAt: NOW,
    });

    expect(receipt).toEqual(expect.objectContaining({
      schemaVersion: "provider-suitability-route-receipt/v1",
      policyId: "policy-sha256",
      compilerVersion: "provider-suitability/v1",
      inputVersion: "work-context/v1",
      selectedProviderId: "openrouter",
      selectedUnderlyingProviderId: "anthropic",
      executionChannel: "direct-api",
      accountClass: "enterprise",
      excludedProviderIds: ["personal-provider"],
      explanationCodes: ["provider-evidence-required"],
    }));
    expect(receipt.connectionRef).toMatch(/^connection-sha256:/);
  });

  it("never serializes raw account identifiers, credentials, explanation text, or payload content", () => {
    const receipt = buildProviderSuitabilityRouteReceipt({
      policy,
      inputVersion: "work-context/v1",
      connection: connection(),
      selectedProviderId: "anthropic",
      excludedProviderIds: [],
      createdAt: NOW,
    });
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toContain("organization-sensitive-id");
    expect(serialized).not.toContain("connection-enterprise");
    expect(serialized).not.toContain("connection-personal");
    expect(serialized).not.toContain("Sensitive explanation");
    expect(serialized).not.toMatch(/api[-_]?key|credential|messages|prompt|payload/i);
  });
});

describe("provider trust evidence revisions", () => {
  it("appends a connection-scoped revision and supersedes older active assertions", async () => {
    const result = await recordProviderTrustEvidence({
      providerConnectionDbId: "connection-db-1",
      claimKey: "dpa-on-file",
      assertedValue: true,
      evidenceType: "provider-contract",
      title: "Reviewed DPA",
      description: "Reviewed for this tenant.",
      collectedAt: NOW,
      expiresAt: new Date("2027-07-20T09:00:00.000Z"),
    });

    expect(result.evidenceId).toMatch(/^provider-trust:connection-db-1:dpa-on-file:/);
    expect(createEvidence).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerConnectionId: "connection-db-1",
        claimKey: "dpa-on-file",
        assertedValue: true,
        status: "active",
      }),
    }));
    expect(updateEvidence).toHaveBeenCalledWith({
      where: {
        providerConnectionId: "connection-db-1",
        claimKey: "dpa-on-file",
        status: "active",
        id: { not: "evidence-db-new" },
      },
      data: { status: "superseded", supersededById: "evidence-db-new" },
    });
  });

  it("withdraws an operator claim without deleting its audit history", async () => {
    await supersedeProviderTrustEvidenceClaim({
      providerConnectionDbId: "connection-db-1",
      claimKey: "no-training",
    });

    expect(updateEvidence).toHaveBeenCalledWith({
      where: {
        providerConnectionId: "connection-db-1",
        claimKey: "no-training",
        status: "active",
      },
      data: { status: "superseded" },
    });
  });
});
