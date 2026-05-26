import Link from "next/link";
import type { CrmTone } from "@/lib/crm/presentation";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";

type CustomerMetricTileProps = {
  href: string;
  label: string;
  value: string;
  detail: string;
  tone: CrmTone;
};

export function CustomerMetricTile({
  href,
  label,
  value,
  detail,
  tone,
}: CustomerMetricTileProps) {
  const toneClasses = CRM_TONE_CLASSES[tone];

  return (
    <Link
      href={href}
      className={[
        "block rounded-lg border-l-2 bg-[var(--dpf-surface-1)] p-3 transition-colors hover:bg-[var(--dpf-surface-2)]",
        toneClasses.border,
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-[var(--dpf-text)]">{value}</p>
      <p className={["mt-1 text-[10px]", toneClasses.text].join(" ")}>
        {detail}
      </p>
    </Link>
  );
}
