type FederationAuthorityCardProps = {
  title: string;
  badge: string;
  description: string;
  status: "connected" | "unconfigured" | "error" | "expired";
  ownershipLabel: string;
  dpfAuthorityLabel: string;
  href: string;
  lastTestedAt?: string | null;
  lastErrorMsg?: string | null;
};

const STATUS_STYLES: Record<FederationAuthorityCardProps["status"], string> = {
  connected: "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]",
  unconfigured: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  error: "border-[var(--dpf-error)] bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  expired: "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
};

const STATUS_LABELS: Record<FederationAuthorityCardProps["status"], string> = {
  connected: "Connected",
  unconfigured: "Not connected",
  error: "Needs attention",
  expired: "Expired",
};

export function FederationAuthorityCard({
  title,
  badge,
  description,
  status,
  ownershipLabel,
  dpfAuthorityLabel,
  href,
  lastTestedAt,
  lastErrorMsg,
}: FederationAuthorityCardProps) {
  return (
    <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">{badge}</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{title}</h2>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">{description}</p>
        </div>
        <span
          className={[
            "rounded-full border px-2 py-1 text-[11px] font-medium",
            STATUS_STYLES[status],
          ].join(" ")}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Upstream owns</p>
          <p className="mt-2 text-sm text-[var(--dpf-text)]">{ownershipLabel}</p>
        </div>
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">DPF still owns</p>
          <p className="mt-2 text-sm text-[var(--dpf-text)]">{dpfAuthorityLabel}</p>
        </div>
      </div>

      {lastTestedAt ? (
        <p className="mt-4 text-xs text-[var(--dpf-muted)]">
          Last validated {formatDateTime(lastTestedAt)}.
        </p>
      ) : null}
      {lastErrorMsg ? (
        <p className="mt-2 rounded-xl border border-[var(--dpf-error)]/30 bg-[var(--dpf-error)]/10 px-3 py-2 text-xs text-[var(--dpf-error)]">
          {lastErrorMsg}
        </p>
      ) : null}

      <a
        href={href}
        className="mt-4 inline-flex text-sm font-medium text-[var(--dpf-accent)] underline-offset-4 hover:underline"
      >
        Review authority details
      </a>
    </article>
  );
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}
