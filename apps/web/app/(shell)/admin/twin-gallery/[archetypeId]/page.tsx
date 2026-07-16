import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ALL_ARCHETYPES,
  deriveDemoBusiness,
  deriveTwinProfile,
  deriveTwinValueStreamBinding,
} from "@dpf/storefront-templates";

import { TwinView } from "@/components/twin";
import { demoBusinessToTwinSnapshot } from "@/lib/twin/demo-business-snapshot";

export const metadata: Metadata = {
  title: "Demo twin — Archetype Demo Gallery",
};

// The full persona'd twin for one archetype (EP-ARCHETYPE-DEMO A·P2), rendered
// through the SAME <TwinView> the live workspace uses — from the generated demo,
// in memory. Deterministic, so safe to static-render.

export default async function TwinGalleryDetailPage({
  params,
}: {
  params: Promise<{ archetypeId: string }>;
}) {
  const { archetypeId } = await params;
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!archetype) notFound();

  const demo = deriveDemoBusiness(archetype);
  const profile = deriveTwinProfile(archetype);
  const binding = deriveTwinValueStreamBinding(archetype);
  const snapshot = demoBusinessToTwinSnapshot(demo, profile, binding);

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/admin/twin-gallery"
          className="text-xs text-[var(--dpf-muted)] no-underline hover:text-[var(--dpf-text-secondary)]"
        >
          &larr; All archetypes
        </Link>
        <div className="mt-1 flex items-baseline gap-2">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{demo.companyName}</h1>
          <span className="text-sm text-[var(--dpf-muted)]">{archetype.name}</span>
          <span className="rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-text-secondary)]">
            {profile.template}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">{demo.narrative.primaryGoal}</p>
      </div>

      <TwinView profile={profile} snapshot={snapshot} />
    </div>
  );
}
