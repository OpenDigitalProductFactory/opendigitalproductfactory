import {
  getDataSourceBadgeLabel,
  getDataSourceDescription,
  getDataSourceTone,
  type DataSourceProvenance,
} from "@/lib/surface-data-provenance";

type Props = {
  provenance: DataSourceProvenance;
  compact?: boolean;
  className?: string;
};

export function DataSourceBadge({ provenance, compact = false, className = "" }: Props) {
  const label = getDataSourceBadgeLabel(provenance);
  const description = getDataSourceDescription(provenance);
  const tone = getDataSourceTone(provenance.kind);

  return (
    <span
      data-source-kind={provenance.kind}
      aria-label={`Data source: ${label}. ${description}`}
      title={description}
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
      <span className="truncate">{label}</span>
      {!compact && <span className="sr-only">: {description}</span>}
    </span>
  );
}
