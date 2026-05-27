import { AlertTriangle, CheckCircle2, HelpCircle, Info } from "lucide-react";

import type { TrustAssessment, TrustTier } from "@/lib/trust-vector";

type Props = {
  trust: TrustAssessment;
  compact?: boolean;
  disclosureLabel?: string;
  className?: string;
};

const TIER_LABELS: Record<TrustTier, string> = {
  high: "High trust",
  medium: "Medium trust",
  low: "Low trust",
  unknown: "Trust unknown",
};

const TIER_TONES: Record<TrustTier, { className: string; dotClassName: string }> = {
  high: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-success)]",
    dotClassName: "bg-[var(--dpf-success)]",
  },
  medium: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-warning)]",
    dotClassName: "bg-[var(--dpf-warning)]",
  },
  low: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-error)]",
    dotClassName: "bg-[var(--dpf-error)]",
  },
  unknown: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
    dotClassName: "bg-[var(--dpf-muted)]",
  },
};

const TIER_ICONS = {
  high: CheckCircle2,
  medium: Info,
  low: AlertTriangle,
  unknown: HelpCircle,
} satisfies Record<TrustTier, typeof CheckCircle2>;

export function TrustBadge({
  trust,
  compact = false,
  disclosureLabel = "Trust details",
  className = "",
}: Props) {
  const label = TIER_LABELS[trust.tier];
  const tone = TIER_TONES[trust.tier];
  const Icon = TIER_ICONS[trust.tier];
  const badge = (
    <span
      data-trust-tier={trust.tier}
      aria-label={`Trust: ${label}. ${trust.primaryRationale}`}
      title={trust.primaryRationale}
      className={[
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[10px] font-medium leading-4",
        tone.className,
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={["h-1.5 w-1.5 shrink-0 rounded-full", tone.dotClassName].join(" ")}
      />
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <span className="sr-only">: {trust.primaryRationale}</span>
    </span>
  );

  if (compact) {
    return badge;
  }

  return (
    <div className="space-y-2 text-xs">
      {badge}
      <p className="text-[var(--dpf-muted)]">{trust.primaryRationale}</p>
      <details className="group">
        <summary className="cursor-pointer text-[var(--dpf-accent)] hover:text-[var(--dpf-text)]">
          {disclosureLabel}
        </summary>
        <dl className="mt-2 space-y-2 border-l border-[var(--dpf-border)] pl-3">
          {trust.dimensions.map((dimension) => (
            <div key={dimension.key} className="min-w-0">
              <dt className="font-medium text-[var(--dpf-text)]">
                {dimension.label}
                <span className="ml-1 text-[var(--dpf-muted)]">({TIER_LABELS[dimension.tier]})</span>
              </dt>
              <dd className="mt-0.5 text-[var(--dpf-muted)]">{dimension.rationale}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
