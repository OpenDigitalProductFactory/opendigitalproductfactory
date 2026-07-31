import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot } from "./demo-snapshot";
import { TwinView } from "./TwinView";

const byCategory = (category: string) => ALL_ARCHETYPES.find((a) => a.category === category)!;

describe("buildDemoTwinSnapshot — totality + determinism", () => {
  it("produces a renderable snapshot for EVERY seeded archetype", () => {
    for (const a of ALL_ARCHETYPES) {
      const profile = deriveTwinProfile(a);
      const snap = buildDemoTwinSnapshot(profile);
      expect(snap.capacityChips.length, `${a.archetypeId} chips`).toBeGreaterThan(0);
      expect(snap.zones.length, `${a.archetypeId} zones`).toBe(profile.zones.length);
      expect(snap.queues.length, `${a.archetypeId} queues`).toBe(profile.queues.length);
      // every zone binds to a real profile zone key
      const zoneKeys = new Set(profile.zones.map((z) => z.key));
      for (const zs of snap.zones) expect(zoneKeys.has(zs.key), `${a.archetypeId} zone ${zs.key}`).toBe(true);
      expect(snap.utility.length).toBeGreaterThan(0);
      expect(snap.presence.some((p) => p.kind === "ai"), `${a.archetypeId} has an AI coworker`).toBe(true);
    }
  });

  it("is deterministic (same profile → identical snapshot)", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    expect(buildDemoTwinSnapshot(profile)).toEqual(buildDemoTwinSnapshot(profile));
  });
});

describe("TwinView — one renderer, both lenses", () => {
  it("renders a physical FLOOR twin with its profile vocabulary and queues", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    expect(profile.template).toBe("FLOOR");
    const html = renderToStaticMarkup(
      <TwinView profile={profile} snapshot={buildDemoTwinSnapshot(profile)} />,
    );
    // zone label from the profile grammar
    expect(html).toContain("Dining room");
    // queue label from the profile grammar
    expect(html).toContain("Waitlist");
    // the shared utility band
    expect(html).toContain("Bills due");
    // the cog proposal references the profile's resource noun
    expect(html).toContain(profile.resourceNoun.singular);
  });

  it("renders a non-physical TENANTS board from the same component", () => {
    const profile = deriveTwinProfile(byCategory("software-platform"));
    expect(profile.template).toBe("TENANTS");
    expect(profile.physical).toBe(false);
    const html = renderToStaticMarkup(
      <TwinView profile={profile} snapshot={buildDemoTwinSnapshot(profile)} />,
    );
    expect(html).toContain("Account health board");
    expect(html).toContain("Renewals at risk");
    // still shows the needs-you + activity surfaces
    expect(html).toContain("Needs you");
    expect(html).toContain("Activity");
  });

  it("uses the shared physical-scene slot instead of rendering a duplicate resource grid", () => {
    const profile = deriveTwinProfile(byCategory("food-hospitality"));
    const snapshot = buildDemoTwinSnapshot(profile);
    const hiddenGridLabel = snapshot.zones[0]?.units[0]?.label;
    const html = renderToStaticMarkup(
      <TwinView
        profile={profile}
        snapshot={snapshot}
        physicalScene={<div>Authored restaurant floor</div>}
      />,
    );

    expect(html).toContain("Authored restaurant floor");
    if (hiddenGridLabel) expect(html).not.toContain(hiddenGridLabel);
    expect(html).toContain("Waitlist");
  });
});
