import type { EstateItem, EstateSupportTone } from "@/lib/estate/estate-item";

type Props = {
  item: EstateItem;
};

const SUPPORT_TONE_CLASSES: Record<EstateSupportTone, string> = {
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
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="6.5" rx="7.5" ry="2.5" />
          <path d="M4.5 6.5v5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-5" />
          <path d="M4.5 11.5v5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-5" />
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
        <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${SUPPORT_TONE_CLASSES[item.supportTone]}`}>
          {item.supportStatusLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Manufacturer</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {item.manufacturerLabel}{item.modelLabel ? ` · ${item.modelLabel}` : ""}
          </p>
        </div>
        <div className="rounded-xl bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Version</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{item.versionLabel}</p>
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
      </div>

      {item.taxonomyPath && (
        <p className="mt-4 text-[11px] font-mono text-[var(--dpf-muted)]">{item.taxonomyPath}</p>
      )}

      <p className="mt-3 text-[11px] font-mono text-[var(--dpf-muted)]">{item.entityKey}</p>
    </article>
  );
}
