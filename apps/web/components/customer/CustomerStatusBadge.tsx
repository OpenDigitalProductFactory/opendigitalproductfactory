import type { CrmTone } from "@/lib/crm/presentation";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";

type CustomerStatusBadgeProps = {
  label: string;
  tone: CrmTone;
  className?: string;
};

export function CustomerStatusBadge({
  label,
  tone,
  className = "",
}: CustomerStatusBadgeProps) {
  return (
    <span
      className={[
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]",
        CRM_TONE_CLASSES[tone].badge,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </span>
  );
}
