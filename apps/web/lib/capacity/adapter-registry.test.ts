import { describe, expect, it, vi } from "vitest";
import type { ResourceCapacityProfile } from "@dpf/storefront-templates";
import type { CapacityAdapter } from "./adapter-registry";
import {
  CAPACITY_ADAPTER_DESCRIPTORS,
  CapacityAdapterRegistry,
  projectCapacitySnapshot,
} from "./adapter-registry";

const profile: ResourceCapacityProfile = {
  archetypeId: "hair-salon",
  category: "beauty-personal-care",
  enabled: true,
  patterns: ["appointment"],
  authorities: ["provider-calendar", "staffing"],
  resourceNoun: { singular: "chair", plural: "chairs" },
  physical: true,
  forwardHorizon: false,
  supportsBuffers: true,
  supportsTravel: false,
};

function adapter(authority: CapacityAdapter["authority"]): CapacityAdapter {
  return {
    authority,
    load: vi.fn(async () => ({
      authority,
      state: "ok" as const,
      resources: [{
        ref: { authority, resourceType: "chair", resourceId: `${authority}-1` },
        organizationId: "org-1",
        label: `${authority} chair`,
        capacity: 1,
        capacityUnit: "appointments",
        status: "available" as const,
        capabilityKeys: [],
      }],
      allocations: [],
      availability: [],
      watermark: { source: authority, observedAt: "2026-08-01T14:00:00.000Z" },
    })),
  };
}

describe("CapacityAdapterRegistry", () => {
  it("describes a canonical source path for every required capacity pattern", () => {
    const patterns = new Set(CAPACITY_ADAPTER_DESCRIPTORS.flatMap((item) => item.patterns));
    for (const pattern of ["appointment", "dispatch", "rental", "class", "venue", "project-resource"] as const) {
      expect(patterns.has(pattern), `${pattern} needs an adapter descriptor`).toBe(true);
    }
    expect(CAPACITY_ADAPTER_DESCRIPTORS.every((item) => item.canonicalSources.length > 0)).toBe(true);
  });

  it("refuses duplicate authority registrations", () => {
    const registry = new CapacityAdapterRegistry([adapter("provider-calendar")]);
    expect(() => registry.register(adapter("provider-calendar"))).toThrow(/already registered/i);
  });

  it("loads only authorities declared by the archetype profile", async () => {
    const provider = adapter("provider-calendar");
    const rental = adapter("rental");
    const snapshot = await projectCapacitySnapshot({
      profile,
      organizationId: "org-1",
      window: { startAt: "2026-08-01T13:00:00.000Z", endAt: "2026-08-01T17:00:00.000Z" },
      registry: new CapacityAdapterRegistry([provider, rental]),
    });

    expect(provider.load).toHaveBeenCalledOnce();
    expect(rental.load).not.toHaveBeenCalled();
    expect(snapshot.resources).toHaveLength(1);
  });

  it("retains missing and degraded authorities instead of treating them as free capacity", async () => {
    const provider = adapter("provider-calendar");
    provider.load = vi.fn<CapacityAdapter["load"]>(async () => ({
      authority: "provider-calendar",
      state: "degraded" as const,
      resources: [],
      allocations: [],
      availability: [],
      diagnostic: "provider calendar unavailable",
    }));

    const snapshot = await projectCapacitySnapshot({
      profile,
      organizationId: "org-1",
      window: { startAt: "2026-08-01T13:00:00.000Z", endAt: "2026-08-01T17:00:00.000Z" },
      registry: new CapacityAdapterRegistry([provider]),
    });

    expect(snapshot.sourceStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ authority: "provider-calendar", state: "degraded" }),
      expect.objectContaining({ authority: "staffing", state: "degraded" }),
    ]));
    expect(snapshot.attentionSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source-degraded" }),
    ]));
  });

  it("rejects cross-organization resources returned by a broken adapter", async () => {
    const broken = adapter("provider-calendar");
    broken.load = vi.fn<CapacityAdapter["load"]>(async () => ({
      authority: "provider-calendar",
      state: "ok" as const,
      resources: [{
        ref: { authority: "provider-calendar", resourceType: "chair", resourceId: "chair-foreign" },
        organizationId: "org-2",
        label: "Foreign chair",
        capacity: 1,
        capacityUnit: "appointments",
        status: "available" as const,
        capabilityKeys: [],
      }],
      allocations: [],
      availability: [],
    }));

    await expect(projectCapacitySnapshot({
      profile,
      organizationId: "org-1",
      window: { startAt: "2026-08-01T13:00:00.000Z", endAt: "2026-08-01T17:00:00.000Z" },
      registry: new CapacityAdapterRegistry([broken]),
    })).rejects.toThrow(/organization scope/i);
  });
});
