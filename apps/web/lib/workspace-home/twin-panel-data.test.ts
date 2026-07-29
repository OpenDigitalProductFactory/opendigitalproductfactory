import { describe, it, expect } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import {
  loadWorkspaceTwinPresentation,
  resolveWorkspaceTwinPresentation,
} from "./twin-panel-data";

const SAMPLE = ALL_ARCHETYPES[0];
const NOW = new Date("2026-07-15T09:00:00Z");

// A fake client for the live projection path. `configured` toggles whether an org
// (with the given archetype) resolves — driving live vs demo fallback.
function fakeDb(configured: { archetypeId: string; name: string } | null) {
  return {
    employeeProfile: {
      findMany: async () => [
        { id: "E-1", displayName: "Sam", status: "active", position: { title: "Server" }, department: { name: "Floor" } },
      ],
    },
    agent: {
      findMany: async () => [
        {
          agentId: "AGT-HOST",
          name: "AI host",
          status: "active",
          valueStream: "operate",
          humanSupervisorId: null,
          portfolioId: null,
          hitlTierDefault: "tier2",
          lifecycleStage: "active",
          executionConfig: null,
          _count: { toolGrants: 0, skills: 0 },
          coworkerNeeds: [],
        },
      ],
    },
    storefrontConfig: { findFirst: async () => (configured ? { archetype: configured } : null) },
    // Org is US → the twin renders USD (from OrgSettings), not the legacy GBP bill row.
    orgSettings: { findFirst: async () => ({ baseCurrency: "USD", locale: "en-US", countryCode: "US" }) },
    bill: { findMany: async () => [{ amountDue: 500, dueDate: NOW, status: "open", currency: "GBP" }] },
    taxObligationPeriod: { findMany: async () => [] },
    obligation: { findMany: async () => [] },
    storefrontBooking: { findMany: async () => [] },
    serviceProvider: { findMany: async () => [] },
  } as never;
}

describe("resolveWorkspaceTwinPresentation", () => {
  it("resolves a profile + snapshot for a real archetype slug", () => {
    const result = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(result).not.toBeNull();
    expect(result?.archetypeId).toBe(SAMPLE.archetypeId);
    expect(result?.archetypeName).toBe(SAMPLE.name);
    expect(result?.profile.template).toBeTruthy();
    expect(result?.snapshot.capacityChips.length).toBeGreaterThan(0);
    expect(result?.demo).toBe(true);
  });

  it("condenses for the home mount — no rival attention surface (cockpit owns it)", () => {
    // The workspace home renders OperatorCockpit as the single attention surface
    // (BI-8C3EB52C); the twin's own cog + needs-you quests must be suppressed.
    const result = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(result?.snapshot.cog).toBeUndefined();
    expect(result?.snapshot.quests).toEqual([]);
    // The operational body still renders.
    expect(result?.snapshot.zones.length).toBeGreaterThan(0);
    expect(result?.snapshot.queues.length).toBeGreaterThan(0);
  });

  it("prefers the supplied display name but falls back to the definition name", () => {
    expect(resolveWorkspaceTwinPresentation(SAMPLE.archetypeId, "Acme Co")?.archetypeName).toBe(
      "Acme Co",
    );
    expect(resolveWorkspaceTwinPresentation(SAMPLE.archetypeId, "  ")?.archetypeName).toBe(
      SAMPLE.name,
    );
  });

  it("returns null for an unconfigured or unknown archetype (never throws)", () => {
    expect(resolveWorkspaceTwinPresentation(null)).toBeNull();
    expect(resolveWorkspaceTwinPresentation(undefined)).toBeNull();
    expect(resolveWorkspaceTwinPresentation("")).toBeNull();
    expect(resolveWorkspaceTwinPresentation("not-a-real-archetype-slug")).toBeNull();
  });

  it("is deterministic — same slug yields the same snapshot", () => {
    const a = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    const b = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(a?.snapshot).toEqual(b?.snapshot);
  });

  it("derives for every archetype without throwing", () => {
    for (const arch of ALL_ARCHETYPES) {
      const result = resolveWorkspaceTwinPresentation(arch.archetypeId);
      expect(result, arch.archetypeId).not.toBeNull();
    }
  });
});

describe("loadWorkspaceTwinPresentation — live overlay", () => {
  it("uses the live projection (demo: false) when the org is configured", async () => {
    const result = await loadWorkspaceTwinPresentation(SAMPLE.archetypeId, null, {
      db: fakeDb({ archetypeId: SAMPLE.archetypeId, name: "Acme Co" }),
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.demo).toBe(false);
    // live presence carries the real workforce (a human + an AI coworker)
    expect(result!.snapshot.presence.some((p) => p.kind === "ai")).toBe(true);
    // real finance flows through, rendered in the ORG currency (USD), not the GBP bill row
    expect(result!.snapshot.utility.find((m) => m.key === "bills")!.value).toContain("$500");
    // home-mount condensing still applies to the live snapshot
    expect(result!.snapshot.cog).toBeUndefined();
    expect(result!.snapshot.quests).toEqual([]);
    expect(result!.operations).toMatchObject({
      freshness: "degraded",
      degradedSourceCount: 1,
    });
    expect(result!.operations!.telemetry.queryCount).toBe(9);
  });

  it("falls back to the demo (demo: true) when no org is configured", async () => {
    const result = await loadWorkspaceTwinPresentation(SAMPLE.archetypeId, null, {
      db: fakeDb(null),
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.demo).toBe(true);
    expect(result!.operations).toBeNull();
    expect(result!.snapshot.cog).toBeUndefined();
  });

  it("returns null for an unresolvable slug regardless of live data", async () => {
    expect(await loadWorkspaceTwinPresentation(null)).toBeNull();
    expect(await loadWorkspaceTwinPresentation("not-a-real-archetype-slug")).toBeNull();
  });
});
