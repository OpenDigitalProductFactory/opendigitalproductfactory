import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capacityFindMany: vi.fn(),
  loadEndpointManifests: vi.fn(),
  loadPolicyRules: vi.fn(),
  loadOverrides: vi.fn(),
  getLocalOnlyInference: vi.fn(),
  resolveDispatchPostures: vi.fn(),
  getTaskRequirement: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    providerCapacityStatus: {
      findMany: mocks.capacityFindMany,
    },
  },
}));

vi.mock("@/lib/routing/loader", () => ({
  loadEndpointManifests: mocks.loadEndpointManifests,
  loadPolicyRules: mocks.loadPolicyRules,
  loadOverrides: mocks.loadOverrides,
}));

vi.mock("@/lib/inference/local-only", () => ({
  getLocalOnlyInference: mocks.getLocalOnlyInference,
}));

vi.mock("@/lib/golden-triangle/dispatch", () => ({
  resolveDispatchPostures: mocks.resolveDispatchPostures,
}));

vi.mock("@/lib/routing/task-requirements", () => ({
  getTaskRequirement: mocks.getTaskRequirement,
}));

import { loadCoworkerRoutingReadinessSnapshot } from "./route-readiness";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadEndpointManifests.mockResolvedValue([]);
  mocks.loadPolicyRules.mockResolvedValue([]);
  mocks.loadOverrides.mockResolvedValue([]);
  mocks.getLocalOnlyInference.mockResolvedValue(false);
  mocks.resolveDispatchPostures.mockResolvedValue(new Map());
  mocks.getTaskRequirement.mockResolvedValue(undefined);
  mocks.capacityFindMany.mockResolvedValue([]);
});

describe("loadCoworkerRoutingReadinessSnapshot", () => {
  it("fails closed when persisted provider capacity cannot be read", async () => {
    mocks.capacityFindMany.mockRejectedValue(
      new Error("capacity store unavailable"),
    );

    await expect(
      loadCoworkerRoutingReadinessSnapshot(["marketing-specialist"]),
    ).resolves.toMatchObject({
      endpoints: [],
      loadError:
        "Routing readiness could not be confirmed. Review AI readiness.",
    });
  });
});
