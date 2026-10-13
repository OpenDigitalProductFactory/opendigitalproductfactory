import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capacity: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { providerCapacityStatus: { findMany: mocks.capacity } } }));
vi.mock("@/lib/routing/loader", () => ({
  loadEndpointManifests: async () => [], loadPolicyRules: async () => [], loadOverrides: async () => [],
}));
vi.mock("@/lib/golden-triangle/dispatch", () => ({ resolveDispatchPostures: async () => new Map() }));
vi.mock("@/lib/inference/local-only", () => ({ getLocalOnlyInference: async () => false }));
vi.mock("@/lib/routing/task-requirements", () => ({ getTaskRequirement: async () => null }));
import { loadCoworkerRoutingReadinessSnapshot } from "./route-readiness";
import { capacityRoutingExclusionReason, STALE_TEMPORARY_CAPACITY_MS } from "@/lib/routing/capacity-routing-exclude";

describe("readiness capacity recovery", () => {
  it("allows an aged temporary limit to recover using its actual observation time", async () => {
    const observed = new Date("2026-10-09T00:00:00Z");
    mocks.capacity.mockResolvedValue([{ providerId: "codex", state: "rate_limited", retryAt: null, lastObservedAt: observed }]);
    const snapshot = await loadCoworkerRoutingReadinessSnapshot();
    expect(snapshot.loadError).toBeUndefined();
    const capacity = snapshot.capacityByProvider.get("codex");
    expect(capacityRoutingExclusionReason(capacity, observed.getTime() + STALE_TEMPORARY_CAPACITY_MS + 1)).toBeNull();
    expect(capacityRoutingExclusionReason(capacity, observed.getTime() + 1)).toContain("rate_limited");
  });

  it("retains auth failures even when the observation is old", async () => {
    const observed = new Date("2026-10-09T00:00:00Z");
    mocks.capacity.mockResolvedValue([{ providerId: "codex", state: "reauth_required", retryAt: null, lastObservedAt: observed }]);
    const snapshot = await loadCoworkerRoutingReadinessSnapshot();
    expect(capacityRoutingExclusionReason(snapshot.capacityByProvider.get("codex"), observed.getTime() + STALE_TEMPORARY_CAPACITY_MS + 1)).toContain("reauth_required");
  });
});
