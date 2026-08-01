"use client";

import Link from "next/link";
import { useState } from "react";

import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

const STATUS_COLOURS: Record<string, string> = {
  active: "var(--dpf-success)",
  draft: "var(--dpf-warning)",
  inactive: "var(--dpf-muted)",
};

/**
 * Product cards shown before the grid collapses behind a "show all".
 *
 * This grid is one card per DigitalProduct carrying discovery evidence, and it
 * was rendered flat: on the live install that is 381 cards — 20,572px, TWO
 * THIRDS of the whole Estate Discovery page, which stood 34 screens tall. The
 * page's own stated purpose is to resolve evidence quality and then "manage the
 * owned estate from portfolio and product pages", so the full roster belongs
 * behind a click, not in the default viewport. Nothing is removed: the toggle
 * still reaches every card, and the section header still states the true total.
 */
const PREVIEW_COUNT = 12;

export type AttributedEstateProduct = {
  id: string;
  name: string;
  lifecycleStatus: string;
  portfolio: { slug: string; name: string } | null;
  taxonomyNodeId: string | null;
};

export function AttributedEstateGrid({
  products,
}: {
  products: AttributedEstateProduct[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? products : products.slice(0, PREVIEW_COUNT);
  const collapsible = products.length > PREVIEW_COUNT;

  if (products.length === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">
        No products are linked to discovered estate evidence yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Said once here rather than repeated verbatim on every card — at 381
            cards that one sentence was ~5,700 words of duplicated UI copy. */}
        <p className="text-dpf-caption text-[var(--dpf-muted)]">
          Open a product to review dependencies, supporting items, and posture in context.
        </p>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((previous) => !previous)}
            className="rounded-full border border-[var(--dpf-border)] px-3 py-1 text-dpf-caption text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
          >
            {expanded ? "Show less" : `Show all ${products.length}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible.map((product) => {
          const colour = product.portfolio
            ? (PORTFOLIO_COLOURS[product.portfolio.slug] ?? "var(--dpf-accent)")
            : "var(--dpf-border)";
          const statusColour = STATUS_COLOURS[product.lifecycleStatus] ?? "var(--dpf-muted)";
          const taxonomyPath = product.taxonomyNodeId
            ? product.taxonomyNodeId.replace(/\//g, " / ")
            : null;

          return (
            <Link
              key={product.id}
              href={`/portfolio/product/${product.id}/inventory`}
              className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)]"
              style={{ borderLeft: `4px solid ${colour}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">{product.name}</p>
                  {product.portfolio && (
                    <p className="mt-1 text-dpf-caption font-medium" style={{ color: colour }}>
                      {product.portfolio.name}
                    </p>
                  )}
                </div>
                <span
                  className="rounded-full px-1.5 py-0.5 text-dpf-caption"
                  style={{ backgroundColor: `${statusColour}20`, color: statusColour }}
                >
                  {product.lifecycleStatus}
                </span>
              </div>
              {taxonomyPath && (
                <p className="mt-2 text-dpf-caption font-mono text-[var(--dpf-muted)]">
                  {taxonomyPath}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
