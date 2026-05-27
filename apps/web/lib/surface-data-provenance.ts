import type { TrustAssessment } from "@/lib/trust-vector";

export type DataSourceKind =
  | "live-db"
  | "connected-account"
  | "computed"
  | "catalog"
  | "seed-default"
  | "demo-placeholder"
  | "not-connected";

export type DataSourceProvenance = {
  kind: DataSourceKind;
  label?: string;
  description: string;
  sourceTable?: string;
  sourceRoute?: string;
  lastVerifiedAt?: string;
  actionHref?: string;
  trust?: TrustAssessment;
};

export type ProvenancedMetric<T = string | number> = {
  label: string;
  value: T;
  provenance?: DataSourceProvenance;
};

export type DataSourceTone = {
  className: string;
  dotClassName: string;
};

const KIND_LABELS: Record<DataSourceKind, string> = {
  "live-db": "Live data",
  "connected-account": "Connected account",
  computed: "Computed",
  catalog: "Catalog",
  "seed-default": "Seed default",
  "demo-placeholder": "Demo placeholder",
  "not-connected": "Not connected",
};

const KIND_TONES: Record<DataSourceKind, DataSourceTone> = {
  "live-db": {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-success)]",
    dotClassName: "bg-[var(--dpf-success)]",
  },
  "connected-account": {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-success)]",
    dotClassName: "bg-[var(--dpf-success)]",
  },
  computed: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]",
    dotClassName: "bg-[var(--dpf-accent)]",
  },
  catalog: {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
    dotClassName: "bg-[var(--dpf-muted)]",
  },
  "seed-default": {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-warning)]",
    dotClassName: "bg-[var(--dpf-warning)]",
  },
  "demo-placeholder": {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-warning)]",
    dotClassName: "bg-[var(--dpf-warning)]",
  },
  "not-connected": {
    className:
      "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-error)]",
    dotClassName: "bg-[var(--dpf-error)]",
  },
};

export function getDataSourceBadgeLabel(provenance: DataSourceProvenance): string {
  return provenance.label ?? KIND_LABELS[provenance.kind];
}

export function getDataSourceTone(kind: DataSourceKind): DataSourceTone {
  return KIND_TONES[kind];
}

export function getDataSourceDescription(provenance: DataSourceProvenance): string {
  const parts = [provenance.description];

  if (provenance.sourceTable) {
    parts.push(`Source table: ${provenance.sourceTable}.`);
  }

  if (provenance.sourceRoute) {
    parts.push(`Source route: ${provenance.sourceRoute}.`);
  }

  if (provenance.lastVerifiedAt) {
    parts.push(`Verified: ${formatVerifiedDate(provenance.lastVerifiedAt)}.`);
  }

  return parts.join(" ");
}

export function isTrustedOperationalSource(kind: DataSourceKind): boolean {
  return kind === "live-db" || kind === "connected-account" || kind === "computed";
}

function formatVerifiedDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}
