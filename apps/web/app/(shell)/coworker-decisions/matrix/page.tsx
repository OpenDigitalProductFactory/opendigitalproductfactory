// EP-0AF96937 Phase 2 completion: the decision matrix view.
// The axes and tier weights every principle is scored on — the thing an
// operator revisits, de-conflicts, or analyzes as decisions accumulate. Live
// per-axis principle counts show where the doctrine concentrates. Read-only:
// adding/reweighting an axis is a governed change. Server component.

import Link from "next/link";
import { prisma } from "@dpf/db";

import {
  buildMatrixDimensions,
  buildMatrixTierWeights,
} from "@/lib/wiki/principle-matrix";
import { STANCE_ALIGNMENT_DIMENSIONS } from "@/lib/decision-perspective/stance-dimension-map";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision matrix · Coworker Decision Engine",
};

export default async function DecisionMatrixPage() {
  const dimensions = buildMatrixDimensions();
  const tierWeights = buildMatrixTierWeights();
  const alignmentDimensionKeys = new Set<string>(STANCE_ALIGNMENT_DIMENSIONS);
  const coreDimensions = dimensions.filter((d) => !alignmentDimensionKeys.has(d.key));
  const alignmentDimensions = dimensions.filter((d) => alignmentDimensionKeys.has(d.key));

  // Live tally: how many published principles weigh on each axis. A near-empty
  // axis or a heavily-loaded one is where de-confliction/analysis tends to land.
  const principles = await prisma.wikiPage.findMany({
    where: { pageKind: "principle", status: "published" },
    select: { principleDimensions: true },
  });
  const countByDimension = new Map<string, number>();
  for (const p of principles) {
    for (const dim of p.principleDimensions ?? []) {
      countByDimension.set(dim, (countByDimension.get(dim) ?? 0) + 1);
    }
  }

  const renderDimension = (d: (typeof dimensions)[number]) => {
    const count = countByDimension.get(d.key) ?? 0;
    return (
      <li key={d.key} className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-sm text-[var(--dpf-text)] min-w-0 flex-1 truncate">
          {d.label}
        </span>
        <span
          className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
          style={{
            color: d.kind === "cost" ? "var(--dpf-warning)" : "var(--dpf-muted)",
            borderColor:
              d.kind === "cost" ? "var(--dpf-warning)" : "var(--dpf-border)",
          }}
        >
          {d.kind}
        </span>
        <span className="text-xs text-[var(--dpf-muted)] shrink-0 w-24 text-right">
          {count} principle{count !== 1 ? "s" : ""}
        </span>
      </li>
    );
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
        </Link>
        <span>/</span>
        <Link href="/coworker-decisions/review" className="hover:text-[var(--dpf-text)]">
          Review &amp; adjust
        </Link>
        <span>/</span>
        <span className="text-[var(--dpf-text)] font-medium">The matrix</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          The decision matrix
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Every principle is scored on these axes. This is the criteria your AI
          weighs — review it when the axes or weights themselves need adjustment.
          The count shows how many principles pull on each axis today.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
          Axes
        </h2>
        <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
          {coreDimensions.map(renderDimension)}
        </ul>
        <details className="mt-3 rounded-lg border border-[var(--dpf-border)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-text)]">
            Business alignment axes
          </summary>
          <ul className="divide-y divide-[var(--dpf-border)] border-t border-[var(--dpf-border)]">
            {alignmentDimensions.map(renderDimension)}
          </ul>
        </details>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
          Tier weights
        </h2>
        <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
          {tierWeights.map((t) => (
            <li key={t.tier} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-sm text-[var(--dpf-text)] min-w-0 flex-1">
                {t.label}
              </span>
              <span className="text-sm text-[var(--dpf-muted)] shrink-0">
                &times;{t.weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--dpf-muted)] mt-2">
          One commandment outweighs ten contextual rules at peak alignment
          (1.00 vs 10 &times; 0.10). Weights and axes are governed — changing one
          is a reviewed change, so decisions stay reproducible.
        </p>
      </section>
    </div>
  );
}
