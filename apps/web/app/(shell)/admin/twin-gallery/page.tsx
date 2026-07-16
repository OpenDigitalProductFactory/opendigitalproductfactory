import type { Metadata } from "next";
import Link from "next/link";

import { ALL_ARCHETYPES, deriveDemoBusiness, deriveTwinProfile } from "@dpf/storefront-templates";

import { demoGalleryCard, type DemoGalleryCard } from "@/lib/twin/demo-business-snapshot";

export const metadata: Metadata = {
  title: "Archetype Demo Gallery — all 94 twins",
};

// Archetype Demo Factory review surface (EP-ARCHETYPE-DEMO A·P2). Renders a
// generated, persona'd demo business for EVERY archetype through the SAME
// derive-with-override generator + twin grammar — in memory, no database — so a
// reviewer scans the whole catalog in minutes, spots the weak ones, and clicks
// through to the full twin. Deterministic, so it is safe to statically render.
// Admin dev surface, reachable directly at /admin/twin-gallery (view_admin gated).

function categoryLabel(category: string): string {
  return category
    .split("-")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

interface CategoryGroup {
  category: string;
  label: string;
  cards: DemoGalleryCard[];
}

function buildGroups(): CategoryGroup[] {
  const byCategory = new Map<string, DemoGalleryCard[]>();
  for (const archetype of ALL_ARCHETYPES) {
    const demo = deriveDemoBusiness(archetype);
    const profile = deriveTwinProfile(archetype);
    const card = demoGalleryCard(demo, profile);
    const list = byCategory.get(archetype.category) ?? [];
    list.push(card);
    byCategory.set(archetype.category, list);
  }
  return Array.from(byCategory.entries())
    .map(([category, cards]) => ({ category, label: categoryLabel(category), cards }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function GalleryCard({ card }: { card: DemoGalleryCard }) {
  const waitIntent = card.longestWaitMinutes > 60 ? "var(--dpf-warning)" : "var(--dpf-muted)";
  return (
    <Link
      href={`/admin/twin-gallery/${card.archetypeId}`}
      className="group flex flex-col gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4 no-underline transition hover:border-[var(--dpf-accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--dpf-text)]">{card.companyName}</div>
          <div className="truncate text-xs text-[var(--dpf-muted)]">{card.archetypeName}</div>
        </div>
        <span className="shrink-0 rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-text-secondary)]">
          {card.template}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-[var(--dpf-muted)]">Zones</dt>
          <dd className="text-[var(--dpf-text-secondary)]">{card.staffedZones.replace(" zones staffed", "")}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--dpf-muted)]">Queue</dt>
          <dd className="text-[var(--dpf-text-secondary)]">{card.queuedDemand}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--dpf-muted)]">Team</dt>
          <dd className="text-[var(--dpf-text-secondary)]">
            {card.workforce} · {card.aiCoworkers} AI
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--dpf-muted)]">Wait</dt>
          <dd style={{ color: waitIntent }}>{card.longestWaitMinutes}m</dd>
        </div>
        <div className="col-span-2 flex justify-between">
          <dt className="text-[var(--dpf-muted)]">Revenue in</dt>
          <dd className="font-medium text-[var(--dpf-success)]">{card.revenueIn}</dd>
        </div>
      </dl>

      <p className="line-clamp-2 border-t border-[var(--dpf-border)] pt-2 text-[11px] italic text-[var(--dpf-muted)]">
        {card.cogProposal}
      </p>
    </Link>
  );
}

export default function AdminTwinGalleryPage() {
  const groups = buildGroups();
  const total = groups.reduce((n, g) => n + g.cards.length, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Archetype Demo Gallery</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          A realistic, persona&rsquo;d demo business for every one of the{" "}
          <span className="font-medium text-[var(--dpf-text-secondary)]">{total}</span> archetypes —
          derived from a single generator, no per-archetype build. Scan the catalogue, then click a
          card for the full living twin.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--dpf-text-secondary)]">
              {group.label}{" "}
              <span className="text-[var(--dpf-muted)]">({group.cards.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.cards.map((card) => (
                <GalleryCard key={card.archetypeId} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
