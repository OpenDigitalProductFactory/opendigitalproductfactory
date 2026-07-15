import type { Metadata } from "next";

import {
  ALL_ARCHETYPES,
  deriveTwinProfile,
  type ArchetypeDefinition,
} from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot } from "@/components/twin";
import { TwinKitShowcase, type TwinExample } from "@/components/twin/TwinKitShowcase";
import { loadLivingBusinessSnapshot } from "@/lib/twin/living-business-snapshot";

export const metadata: Metadata = {
  title: "Operational Twin Kit — preview",
};

// The projection queries the live org — render at request time, never prerender.
export const dynamic = "force-dynamic";

// Fixture/reference surface for the Operational Twin renderer (P3). Not linked
// from the admin nav — it is a developer preview reachable directly at
// /admin/twin-kit, gated by the admin layout's view_admin guard. Every panel is
// rendered by the SAME <TwinView> from a real deriveTwinProfile(archetype) plus a
// deterministic demo snapshot; only the archetype differs. When the live
// LivingBusinessSnapshot projection lands (parent spec P4), it drops in behind the
// same TwinSnapshot shape and these become live.

// A spread across both lenses — physical space and non-physical boards — proving
// one renderer serves every archetype. Chosen by category; falls back gracefully
// if a category has no seeded leaf.
const SHOWCASE_CATEGORIES: Array<{ category: string; kind: string }> = [
  { category: "food-hospitality", kind: "physical · floor" },
  { category: "trades-maintenance", kind: "physical · territory" },
  { category: "asset-rental", kind: "physical · yard" },
  { category: "software-platform", kind: "board · tenants" },
  { category: "professional-services", kind: "board · pipeline" },
  { category: "nonprofit-community", kind: "board · programs" },
];

function firstInCategory(category: string): ArchetypeDefinition | undefined {
  return ALL_ARCHETYPES.find((a) => a.category === category);
}

export default async function AdminTwinKitPage() {
  const demoExamples: TwinExample[] = SHOWCASE_CATEGORIES.flatMap(({ category, kind }) => {
    const archetype = firstInCategory(category);
    if (!archetype) return [];
    const profile = deriveTwinProfile(archetype);
    return [
      {
        id: archetype.archetypeId,
        label: archetype.name,
        kind,
        template: profile.template,
        profile,
        snapshot: buildDemoTwinSnapshot(profile),
      },
    ];
  });

  // The live twin for THIS deployment's org, projected from real substrate
  // (workforce roster, finance spine, bookings). Null when no org is configured —
  // then only the demo archetypes show. When present it leads as the default tab.
  const live = await loadLivingBusinessSnapshot();
  const liveDef = live ? ALL_ARCHETYPES.find((a) => a.archetypeId === live.archetypeId) : undefined;
  const liveExample: TwinExample | null =
    live && liveDef
      ? {
          id: `live:${live.archetypeId}`,
          label: `${live.archetypeName}`,
          kind: "live · this business",
          template: live.template,
          profile: deriveTwinProfile(liveDef),
          snapshot: live,
        }
      : null;

  const examples: TwinExample[] = liveExample ? [liveExample, ...demoExamples] : demoExamples;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operational Twin</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          One renderer, every archetype — each panel below is the same{" "}
          <code className="text-[var(--dpf-text-secondary)]">TwinView</code> driven by a real{" "}
          <code className="text-[var(--dpf-text-secondary)]">deriveTwinProfile</code> and demo
          data. Switch archetype to see the template, vocabulary, and queues change.
        </p>
      </div>
      <TwinKitShowcase examples={examples} />
    </div>
  );
}
