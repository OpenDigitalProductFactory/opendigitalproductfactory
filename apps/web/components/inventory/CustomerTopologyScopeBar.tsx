import { Building2, Network, ShieldCheck } from "lucide-react";

type Props = {
  mode: "organization-internal" | "customer-account" | "customer-site";
  scopeLabel: string;
  siteLabel?: string | null;
  edgeNodeLabel?: string | null;
  lastRunLabel?: string | null;
};

export function CustomerTopologyScopeBar({
  mode,
  scopeLabel,
  siteLabel,
  edgeNodeLabel,
  lastRunLabel,
}: Props) {
  const modeLabel = mode === "organization-internal" ? "Internal estate" : "Customer estate";

  return (
    <div className="flex flex-wrap items-center gap-3 border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-[var(--dpf-text)]">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {mode === "organization-internal" ? <Building2 size={16} /> : <ShieldCheck size={16} />}
        <span>{scopeLabel}</span>
      </div>
      <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
        {modeLabel}
      </span>
      {siteLabel ? (
        <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          {siteLabel}
        </span>
      ) : null}
      {edgeNodeLabel ? (
        <span className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
          <Network size={14} />
          {edgeNodeLabel}
        </span>
      ) : null}
      {lastRunLabel ? (
        <span className="ml-auto text-xs text-[var(--dpf-muted)]">{lastRunLabel}</span>
      ) : null}
    </div>
  );
}
