// EP-WIKI-001 Phase 6a: list view of wiki pages with simple grouping.
// Principles-as-wiki-kind Phase 0: principles are grouped by tier
// (Commandments → Core → Contextual) within their kind section.
// Server component. Pages are passed in already filtered + sorted.

import Link from "next/link";
import type { ReactNode } from "react";

import { WikiPageKindBadge } from "./WikiPageKindBadge";

export type WikiPageListItem = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  abstract: string | null;
  /** Only meaningful when pageKind === "principle". Drives tier sub-grouping. */
  principleTier?: string | null;
};

type Props = {
  pages: WikiPageListItem[];
};

const KIND_ORDER = [
  "principle", // governance comes first when present — the heaviest signal
  "stance",
  "heuristic",
  "decision",
  "entity",
  "summary",
  "runbook",
  "index",
];

const KIND_GROUP_LABEL: Record<string, string> = {
  principle: "Principles",
  stance: "Stances",
  heuristic: "Heuristics",
  decision: "Decisions",
  entity: "Entities",
  summary: "Summaries",
  runbook: "Runbooks",
  index: "Indices",
};

// Tier order is fixed — Commandments first (highest weight, smallest cohort),
// then Core, then Contextual. Reflects PRINCIPLE_TIERS in wiki-taxonomy.
const PRINCIPLE_TIER_ORDER = ["commandment", "core", "contextual"];

const PRINCIPLE_TIER_LABEL: Record<string, string> = {
  commandment: "Commandments",
  core: "Core",
  contextual: "Contextual",
};

/**
 * Sub-group principle items by tier. Returns groups in canonical
 * Commandments → Core → Contextual order, dropping empty tiers. Items
 * with an unknown or missing tier are collected into a trailing
 * "Untiered" group so drafts pending review remain visible.
 */
export type PrincipleTierGroup = {
  tier: string;
  label: string;
  items: WikiPageListItem[];
};

export function groupPrinciplesByTier(
  items: WikiPageListItem[],
): PrincipleTierGroup[] {
  const buckets = new Map<string, WikiPageListItem[]>();
  for (const item of items) {
    // Coerce missing or unrecognized tier values into the "untiered" bucket
    // so misconfigured rows stay visible to the admin instead of vanishing.
    const declared = item.principleTier;
    const tier =
      declared && PRINCIPLE_TIER_ORDER.includes(declared)
        ? declared
        : "untiered";
    let bucket = buckets.get(tier);
    if (!bucket) {
      bucket = [];
      buckets.set(tier, bucket);
    }
    bucket.push(item);
  }

  const groups: PrincipleTierGroup[] = [];
  for (const tier of PRINCIPLE_TIER_ORDER) {
    const bucket = buckets.get(tier);
    if (bucket && bucket.length > 0) {
      groups.push({ tier, label: PRINCIPLE_TIER_LABEL[tier] ?? tier, items: bucket });
    }
  }
  // Untiered drafts come last so they're easy to spot.
  const untiered = buckets.get("untiered");
  if (untiered && untiered.length > 0) {
    groups.push({ tier: "untiered", label: "Untiered", items: untiered });
  }
  return groups;
}

export function WikiPageList({ pages }: Props): ReactNode {
  if (pages.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--dpf-muted)]">
          No wiki pages yet. The founder kernel seeds when content lands under{" "}
          <code className="text-xs px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
            docs/founder-kernel/wiki/
          </code>
          .
        </p>
      </div>
    );
  }

  // Group by pageKind preserving the canonical KIND_ORDER.
  const byKind = new Map<string, WikiPageListItem[]>();
  for (const p of pages) {
    let bucket = byKind.get(p.pageKind);
    if (!bucket) {
      bucket = [];
      byKind.set(p.pageKind, bucket);
    }
    bucket.push(p);
  }

  // Append any unrecognized kinds at the end (defensive).
  const orderedKinds = [
    ...KIND_ORDER.filter((k) => byKind.has(k)),
    ...Array.from(byKind.keys()).filter((k) => !KIND_ORDER.includes(k)),
  ];

  function renderItemRow(p: WikiPageListItem): ReactNode {
    return (
      <li key={p.id}>
        <Link
          href={`/wiki/${p.slug}`}
          className="block px-3 py-2 hover:bg-[var(--dpf-surface-2)]"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <WikiPageKindBadge pageKind={p.pageKind} />
            <span className="text-sm font-medium text-[var(--dpf-text)]">
              {p.title}
            </span>
            {!p.isKernel && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
                overlay
              </span>
            )}
            {p.status !== "published" && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
                · {p.status}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--dpf-muted)] font-mono mt-0.5">
            {p.slug}
          </p>
          {p.abstract && (
            <p className="text-xs text-[var(--dpf-muted)] mt-1 line-clamp-2">
              {p.abstract}
            </p>
          )}
        </Link>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      {orderedKinds.map((kind) => {
        const items = byKind.get(kind) ?? [];
        if (kind === "principle") {
          const tierGroups = groupPrinciplesByTier(items);
          return (
            <section key={kind}>
              <h2 className="text-xs uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
                {KIND_GROUP_LABEL[kind] ?? kind} · {items.length}
              </h2>
              <div className="space-y-3">
                {tierGroups.map((group) => (
                  <div key={group.tier}>
                    <h3 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1 ml-1">
                      {group.label} · {group.items.length}
                    </h3>
                    <ul className="divide-y divide-[var(--dpf-border)] border border-[var(--dpf-border)] rounded">
                      {group.items.map(renderItemRow)}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        return (
          <section key={kind}>
            <h2 className="text-xs uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
              {KIND_GROUP_LABEL[kind] ?? kind} · {items.length}
            </h2>
            <ul className="divide-y divide-[var(--dpf-border)] border border-[var(--dpf-border)] rounded">
              {items.map(renderItemRow)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
