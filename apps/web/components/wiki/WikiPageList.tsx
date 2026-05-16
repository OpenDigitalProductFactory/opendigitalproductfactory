// EP-WIKI-001 Phase 6a: list view of wiki pages with simple grouping.
// Principles-as-wiki-kind: principles are grouped by consumer archetype first,
// then tier, so humans can review them by the context that consumes them.
// Server component. Pages are passed in already filtered + sorted.

import Link from "next/link";
import type { ReactNode } from "react";

import {
  PRINCIPLE_CONSUMER_ARCHETYPES,
  PRINCIPLE_TIERS,
} from "@dpf/db/wiki-taxonomy";

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
  /** Only meaningful when pageKind === "principle". Drives human review grouping. */
  principleConsumerArchetype?: string | null;
  /** Route/domain contexts for route-domain-specific principles. */
  principleConsumerContexts?: string[];
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

const PRINCIPLE_TIER_LABEL: Record<string, string> = {
  commandment: "Commandments",
  core: "Core",
  contextual: "Contextual",
};

const PRINCIPLE_CONSUMER_LABEL: Record<string, string> = {
  universal: "Universal",
  "ai-coworker-universal": "AI Coworker Universal",
  generalist: "Generalist / COO",
  specialist: "Specialists",
  "route-domain-specific": "Route / Domain Specific",
  uncategorized: "Uncategorized",
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

export type PrincipleConsumerContextGroup = {
  context: string;
  label: string;
  tierGroups: PrincipleTierGroup[];
};

export type PrincipleConsumerArchetypeGroup = {
  archetype: string;
  label: string;
  tierGroups: PrincipleTierGroup[];
  contextGroups: PrincipleConsumerContextGroup[];
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
      declared && (PRINCIPLE_TIERS as readonly string[]).includes(declared)
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
  for (const tier of PRINCIPLE_TIERS) {
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

function formatConsumerContextLabel(context: string): string {
  if (context === "unscoped") return "Unscoped";
  return context
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function groupPrinciplesByConsumerArchetype(
  items: WikiPageListItem[],
): PrincipleConsumerArchetypeGroup[] {
  const buckets = new Map<string, WikiPageListItem[]>();
  for (const item of items) {
    const declared = item.principleConsumerArchetype;
    const archetype =
      declared &&
      (PRINCIPLE_CONSUMER_ARCHETYPES as readonly string[]).includes(declared)
        ? declared
        : "uncategorized";
    let bucket = buckets.get(archetype);
    if (!bucket) {
      bucket = [];
      buckets.set(archetype, bucket);
    }
    bucket.push(item);
  }

  const orderedArchetypes = [
    ...PRINCIPLE_CONSUMER_ARCHETYPES.filter((archetype) =>
      buckets.has(archetype),
    ),
    ...Array.from(buckets.keys()).filter(
      (archetype) =>
        !(PRINCIPLE_CONSUMER_ARCHETYPES as readonly string[]).includes(archetype),
    ),
  ];

  return orderedArchetypes.map((archetype) => {
    const groupItems = buckets.get(archetype) ?? [];
    const contextGroups =
      archetype === "route-domain-specific"
        ? groupRouteSpecificPrinciplesByContext(groupItems)
        : [];
    return {
      archetype,
      label: PRINCIPLE_CONSUMER_LABEL[archetype] ?? archetype,
      tierGroups: groupPrinciplesByTier(groupItems),
      contextGroups,
    };
  });
}

function groupRouteSpecificPrinciplesByContext(
  items: WikiPageListItem[],
): PrincipleConsumerContextGroup[] {
  const buckets = new Map<string, WikiPageListItem[]>();
  for (const item of items) {
    const contexts =
      item.principleConsumerContexts && item.principleConsumerContexts.length > 0
        ? item.principleConsumerContexts
        : ["unscoped"];
    for (const context of contexts) {
      let bucket = buckets.get(context);
      if (!bucket) {
        bucket = [];
        buckets.set(context, bucket);
      }
      bucket.push(item);
    }
  }

  const contexts = Array.from(buckets.keys()).sort((a, b) => {
    if (a === "build-studio") return -1;
    if (b === "build-studio") return 1;
    if (a === "unscoped") return 1;
    if (b === "unscoped") return -1;
    return a.localeCompare(b);
  });

  return contexts.map((context) => ({
    context,
    label: formatConsumerContextLabel(context),
    tierGroups: groupPrinciplesByTier(buckets.get(context) ?? []),
  }));
}

function countTierGroupItems(groups: PrincipleTierGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
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
    const consumerLabel = p.principleConsumerArchetype
      ? PRINCIPLE_CONSUMER_LABEL[p.principleConsumerArchetype] ??
        p.principleConsumerArchetype
      : null;
    const contexts = p.principleConsumerContexts ?? [];
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
            {p.pageKind === "principle" && consumerLabel && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] border border-[var(--dpf-border)] rounded px-1 py-0.5">
                {consumerLabel}
              </span>
            )}
            {p.pageKind === "principle" &&
              contexts.map((context) => (
                <span
                  key={context}
                  className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] border border-[var(--dpf-border)] rounded px-1 py-0.5"
                >
                  {formatConsumerContextLabel(context)}
                </span>
              ))}
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

  function renderTierGroups(groups: PrincipleTierGroup[]): ReactNode {
    return groups.map((tierGroup) => (
      <div key={tierGroup.tier}>
        <h4 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1 ml-1">
          {tierGroup.label} · {tierGroup.items.length}
        </h4>
        <ul className="divide-y divide-[var(--dpf-border)] border border-[var(--dpf-border)] rounded">
          {tierGroup.items.map(renderItemRow)}
        </ul>
      </div>
    ));
  }

  function renderRouteContextGroups(
    groups: PrincipleConsumerContextGroup[],
  ): ReactNode {
    return groups.map((contextGroup) => (
      <div key={contextGroup.context}>
        <h4 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1 ml-1">
          {contextGroup.label} · {countTierGroupItems(contextGroup.tierGroups)}
        </h4>
        <div className="space-y-2">
          {renderTierGroups(contextGroup.tierGroups)}
        </div>
      </div>
    ));
  }

  function renderPrincipleConsumerGroups(
    groups: PrincipleConsumerArchetypeGroup[],
  ): ReactNode {
    return groups.map((consumerGroup) => (
      <div key={consumerGroup.archetype}>
        <h3 className="text-[11px] uppercase tracking-wide text-[var(--dpf-muted)] mb-2 ml-1">
          {consumerGroup.label} · {countTierGroupItems(consumerGroup.tierGroups)}
        </h3>
        <div className="space-y-3">
          {consumerGroup.archetype === "route-domain-specific"
            ? renderRouteContextGroups(consumerGroup.contextGroups)
            : renderTierGroups(consumerGroup.tierGroups)}
        </div>
      </div>
    ));
  }

  return (
    <div className="space-y-6">
      {orderedKinds.map((kind) => {
        const items = byKind.get(kind) ?? [];
        if (kind === "principle") {
          const consumerGroups = groupPrinciplesByConsumerArchetype(items);
          return (
            <section key={kind}>
              <h2 className="text-xs uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
                {KIND_GROUP_LABEL[kind] ?? kind} · {items.length}
              </h2>
              <div className="space-y-5">
                {renderPrincipleConsumerGroups(consumerGroups)}
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
