// EP-WIKI-001 Phase 6a: page detail viewer.
// Principles-as-wiki-kind Phase 0: principle pages get an extra metadata
// panel below the title (tier, applies-to, public state, weight, dimension
// vector). Server component.

import Link from "next/link";
import type { ReactNode } from "react";

import {
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  isPrincipleTier,
} from "@dpf/db/wiki-taxonomy";

import { WikiBodyRenderer } from "./WikiBodyRenderer";
import { WikiPageKindBadge } from "./WikiPageKindBadge";
import { WikiSourceCitations, type WikiSourceCitation } from "./WikiSourceCitations";

export type WikiPageDetail = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  kernelVersion: string | null;
  organizationId: string | null;
  kernelPageId: string | null;
  derivedFromKernelVersion: string | null;
  abstract: string | null;
  lastReviewedAt: Date | null;
  updatedAt: Date;
  sources: WikiSourceCitation[];
  // ─── Principle-only (only meaningful when pageKind === "principle") ─────
  principleTier?: string | null;
  principleDirection?: string | null;
  principleWeight?: number | null;
  principleDimensionVector?: Record<string, number> | null;
  principleDimensions?: string[];
  principleAppliesTo?: string[];
  principlePublic?: boolean;
};

/**
 * Resolve the effective weight a principle contributes to decision math:
 * the explicit override if set, otherwise the tier default. Returns null
 * for principles without a recognized tier so the UI can fall back to a
 * neutral display.
 */
export function getPrincipleDisplayWeight(
  tier: string | null | undefined,
  override: number | null | undefined,
): number | null {
  if (typeof override === "number") {
    return override;
  }
  if (tier && isPrincipleTier(tier)) {
    return PRINCIPLE_TIER_DEFAULT_WEIGHT[tier];
  }
  return null;
}

const TIER_LABEL: Record<string, string> = {
  commandment: "Commandment",
  core: "Core",
  contextual: "Contextual",
};

const APPLIES_TO_LABEL: Record<string, string> = {
  in_platform_coworker: "In-platform coworker",
  external_coding_agent: "External coding agent",
  human: "Human",
};

type Props = {
  page: WikiPageDetail;
};

function formatOrigin(page: WikiPageDetail): string {
  if (page.isKernel) {
    return page.kernelVersion ? `Kernel · v${page.kernelVersion}` : "Kernel";
  }
  if (page.kernelPageId) {
    return page.derivedFromKernelVersion
      ? `Org overlay (overrides kernel v${page.derivedFromKernelVersion})`
      : "Org overlay";
  }
  return "Org-original";
}

function PrincipleMetadataPanel({ page }: { page: WikiPageDetail }): ReactNode {
  const tier = page.principleTier;
  const tierLabel = tier ? TIER_LABEL[tier] ?? tier : "Untiered";
  const weight = getPrincipleDisplayWeight(tier, page.principleWeight);
  const appliesTo = page.principleAppliesTo ?? [];
  const dimensions = page.principleDimensions ?? [];
  const vector = page.principleDimensionVector ?? null;

  return (
    <section
      aria-label="Principle metadata"
      className="mb-6 p-4 border border-[var(--dpf-border)] rounded bg-[var(--dpf-surface-2)]"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]">
          {tierLabel}
        </span>
        {weight !== null && (
          <span className="text-xs text-[var(--dpf-muted)]">
            weight {weight.toFixed(2)}
          </span>
        )}
        <span className="text-xs text-[var(--dpf-muted)]">
          · {page.principlePublic ? "Public" : "Internal"}
        </span>
        <span className="text-xs text-[var(--dpf-muted)]">
          · {page.sources.length} source{page.sources.length === 1 ? "" : "s"}
        </span>
      </div>

      {page.principleDirection && (
        <p className="text-sm text-[var(--dpf-text)] mb-3 leading-relaxed">
          {page.principleDirection}
        </p>
      )}

      {appliesTo.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1">
            Applies to
          </h3>
          <div className="flex flex-wrap gap-1">
            {appliesTo.map((aud) => (
              <span
                key={aud}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border border-[var(--dpf-border)] text-[var(--dpf-muted)] bg-[var(--dpf-surface-1)]"
              >
                {APPLIES_TO_LABEL[aud] ?? aud}
              </span>
            ))}
          </div>
        </div>
      )}

      {dimensions.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1">
            Decision dimensions
          </h3>
          {vector ? (
            <table className="text-xs w-full">
              <tbody>
                {dimensions.map((dim) => (
                  <tr key={dim} className="border-t border-[var(--dpf-border)]">
                    <td className="py-1 text-[var(--dpf-text)]">{dim}</td>
                    <td className="py-1 text-right text-[var(--dpf-muted)] font-mono">
                      {typeof vector[dim] === "number"
                        ? vector[dim].toFixed(2)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-wrap gap-1">
              {dimensions.map((dim) => (
                <span
                  key={dim}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
                >
                  {dim}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function WikiPageViewer({ page }: Props): ReactNode {
  return (
    <article className="max-w-3xl mx-auto py-6 px-4">
      <nav className="mb-3 text-xs text-[var(--dpf-muted)] flex items-center justify-between">
        <Link href="/wiki" className="hover:underline">
          ← Wiki
        </Link>
        <Link
          href={`/wiki/edit/${page.slug}`}
          className="rounded border border-[var(--dpf-border)] px-2 py-1 hover:bg-[var(--dpf-surface-2)]"
          aria-label={
            page.isKernel
              ? "Override this kernel page with an org-scoped version"
              : "Edit this page"
          }
        >
          {page.isKernel ? "Override in your org" : "Edit"}
        </Link>
      </nav>

      <header className="mb-6 pb-4 border-b border-[var(--dpf-border)]">
        <div className="flex items-center gap-2 mb-2">
          <WikiPageKindBadge pageKind={page.pageKind} />
          <span className="text-xs text-[var(--dpf-muted)]">{formatOrigin(page)}</span>
          {page.status !== "published" && (
            <span className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
              · {page.status}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          {page.title}
        </h1>
        <p className="text-xs text-[var(--dpf-muted)] font-mono">{page.slug}</p>
        {page.abstract && (
          <p className="mt-3 text-sm text-[var(--dpf-text)] leading-relaxed">
            {page.abstract}
          </p>
        )}
      </header>

      {page.pageKind === "principle" && <PrincipleMetadataPanel page={page} />}

      <section className="mb-8">
        <WikiBodyRenderer body={page.body} />
      </section>

      <aside className="border-t border-[var(--dpf-border)] pt-4 mt-8">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">Sources</h2>
        <WikiSourceCitations sources={page.sources} />
      </aside>

      <footer className="mt-6 text-xs text-[var(--dpf-muted)]">
        {page.lastReviewedAt && (
          <span>Last reviewed {page.lastReviewedAt.toISOString().slice(0, 10)} · </span>
        )}
        Updated {page.updatedAt.toISOString().slice(0, 10)}
      </footer>
    </article>
  );
}
