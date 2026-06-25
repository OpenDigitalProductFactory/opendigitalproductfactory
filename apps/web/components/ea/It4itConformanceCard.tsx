// apps/web/components/ea/It4itConformanceCard.tsx
//
// Compact IT4IT conformance summary for the EA home (EP-IT4IT-CONFORMANCE, BI-BDA1A04F).
// Server component: honest headline counts (no single vanity score in isolation), deep-links
// to the full heatmap on the model page. Renders a neutral not-generated state until the
// steward writes the baseline. Reuses report-kit StatCard; no charting dependency, no hex.

import Link from "next/link";
import { StatCard } from "@/components/ui/report-kit/StatCard";
import type { It4itCoverageHeatmap } from "@/lib/explore/reference-model-types";

const MODEL_HREF = "/ea/models/it4it_v3_0_1";
const DISCLAIMER = "Evidence-derived coverage baseline, not an Open Group certification.";

function Header() {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">IT4IT Conformance</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Functional Coverage</h2>
      </div>
      <Link
        href={MODEL_HREF}
        className="text-xs font-medium text-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
      >
        View heatmap
      </Link>
    </div>
  );
}

export function It4itConformanceCard({ data }: { data: It4itCoverageHeatmap }) {
  if (!data.hasData) {
    return (
      <section className="mb-6">
        <Header />
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          IT4IT coverage baseline not generated yet — run an architecture parity refresh. {DISCLAIMER}
        </div>
      </section>
    );
  }

  const requiredCovered = data.summary.requiredCriteriaImplemented + data.summary.requiredCriteriaPartial;

  return (
    <section className="mb-6">
      <Header />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Platform coverage"
          value={`${data.platformScore}%`}
          hint="status-weighted"
          href={MODEL_HREF}
        />
        <StatCard
          label="Components w/ evidence"
          value={`${data.summary.componentsWithEvidence}/${data.summary.componentsTotal}`}
          hint={`${data.summary.implemented} implemented · ${data.summary.partial} partial`}
        />
        <StatCard
          label="Required criteria covered"
          value={`${requiredCovered}/${data.summary.requiredCriteriaTotal}`}
          hint={`${data.summary.requiredCriteriaImplemented} implemented`}
        />
        <StatCard
          label="Verified"
          value={data.summary.verifiedCount}
          hint={data.summary.verifiedCount > 0 ? "operator-confirmed" : "all derived"}
          intent={data.summary.verifiedCount > 0 ? "success" : "neutral"}
        />
      </div>
      <p className="mt-2 text-[10px] text-[var(--dpf-muted)]">{DISCLAIMER}</p>
    </section>
  );
}
