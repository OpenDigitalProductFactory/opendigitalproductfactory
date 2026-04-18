import type { EstateIndicatorTone, EstateItem, EstateSupportTone } from "@/lib/estate/estate-item";

type Props = {
  item: EstateItem;
};

const TONE_CLASSES: Record<EstateSupportTone | EstateIndicatorTone, string> = {
  good: "border-[var(--dpf-success)]/30 bg-[color-mix(in_srgb,var(--dpf-success)_12%,transparent)] text-[var(--dpf-success)]",
  warn: "border-[var(--dpf-warning)]/30 bg-[color-mix(in_srgb,var(--dpf-warning)_12%,transparent)] text-[var(--dpf-warning)]",
  danger: "border-[var(--dpf-error)]/30 bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] text-[var(--dpf-error)]",
  neutral: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
};

function EstateGlyph({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "gateway":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="7" width="16" height="8" rx="2" />
          <path d="M8 18h8" />
          <path d="M9 11h.01M12 11h.01M15 11h.01" />
        </svg>
      );
    case "switch":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3.5" y="7" width="17" height="10" rx="2" />
          <path d="M7 11h2M11 11h2M15 11h2M7 14h10" />
        </svg>
      );
    case "wifi":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 9a12 12 0 0 1 16 0" />
          <path d="M7 12a7.5 7.5 0 0 1 10 0" />
          <path d="M10 15a3.2 3.2 0 0 1 4 0" />
          <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "camera":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="8" width="12" height="8" rx="2" />
          <path d="M16 11l4-2v6l-4-2z" />
        </svg>
      );
    case "security":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3l7 3v5c0 4.6-2.7 7.7-7 10-4.3-2.3-7-5.4-7-10V6z" />
          <path d="M9.5 11.5l1.7 1.7 3.3-3.3" />
        </svg>
      );
    case "facility":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 20V8l8-4 8 4v12" />
          <path d="M9 20v-5h6v5" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      );
    case "media":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M10 10l5 2-5 2z" />
        </svg>
      );
    case "host":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="5" width="16" height="10" rx="2" />
          <path d="M10 19h4M8 15h8" />
        </svg>
      );
    case "device":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="4" width="10" height="16" rx="2" />
          <path d="M17 8h2.5M17 12h2.5M17 16h2.5" />
          <circle cx="10" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "service":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="5" width="14" height="4" rx="1.5" />
          <rect x="5" y="10" width="14" height="4" rx="1.5" />
          <rect x="5" y="15" width="14" height="4" rx="1.5" />
        </svg>
      );
    case "package":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3l7 4v10l-7 4-7-4V7z" />
          <path d="M12 3v18M5 7l7 4 7-4" />
        </svg>
      );
    case "storage":
    case "database":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="6.5" rx="7.5" ry="2.5" />
          <path d="M4.5 6.5v5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-5" />
          <path d="M4.5 11.5v5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-5" />
        </svg>
      );
    case "container":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4.5" y="6" width="15" height="12" rx="2" />
          <path d="M8 6v12M12 6v12M16 6v12" />
          <path d="M4.5 10h15M4.5 14h15" />
        </svg>
      );
    case "application":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 8h8v8H8z" />
        </svg>
      );
    case "monitoring":
    case "network":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="18" cy="17" r="2" />
          <path d="M8 12h4M14 8.2l-2.2 2.1M14 15.8l-2.2-2.1" />
        </svg>
      );
    case "ai":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 4l1.6 3.2L17 8.5l-2.5 2.4.6 3.4L12 12.8 8.9 14.3l.6-3.4L7 8.5l3.4-1.3z" />
          <path d="M5 20h14" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="5" width="14" height="14" rx="3" />
          <path d="M9 12h6" />
        </svg>
      );
  }
}

export function EstateItemCard({ item }: Props) {
  return (
    <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--dpf-surface-2)] p-3 text-[var(--dpf-accent)]" aria-hidden="true">
            <EstateGlyph iconKey={item.iconKey} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{item.name}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              {item.technicalClassLabel}
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${TONE_CLASSES[item.supportTone]}`}>
          {item.supportStatusLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Identity</p>
          <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">{item.identityLabel}</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {item.manufacturerLabel}{item.modelLabel ? ` · ${item.modelLabel}` : ""}
          </p>
          <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-medium ${TONE_CLASSES[item.identityConfidenceTone]}`}>
            {item.identityConfidenceLabel}
          </span>
        </div>
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Version</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{item.versionLabel}</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{item.versionSourceLabel}</p>
          <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-medium ${TONE_CLASSES[item.versionConfidenceTone]}`}>
            {item.versionConfidenceLabel}
          </span>
        </div>
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Discovery freshness</p>
          <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-medium ${TONE_CLASSES[item.freshnessTone]}`}>
            {item.freshnessLabel}
          </span>
        </div>
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Blast radius</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{item.blastRadiusLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Support posture</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{item.supportSummaryLabel}</p>
        </div>
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Advisories</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{item.advisorySummaryLabel}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--dpf-muted)]">
        <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1">
          {item.upstreamCount} upstream
        </span>
        <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1">
          {item.downstreamCount} downstream
        </span>
        <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1">
          View: {item.providerViewLabel}
        </span>
        <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1">
          Status: {item.statusLabel}
        </span>
        {item.openIssueCount > 0 && (
          <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1">
            {item.openIssueCount} open issue{item.openIssueCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {item.postureBadges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {item.postureBadges.map((badge) => (
            <span
              key={badge.label}
              className={`rounded-full border px-2 py-1 ${TONE_CLASSES[badge.tone]}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      {item.taxonomyPath && (
        <p className="mt-4 text-[11px] font-mono text-[var(--dpf-muted)]">{item.taxonomyPath}</p>
      )}

      <p className="mt-3 text-[11px] font-mono text-[var(--dpf-muted)]">{item.entityKey}</p>
    </article>
  );
}
