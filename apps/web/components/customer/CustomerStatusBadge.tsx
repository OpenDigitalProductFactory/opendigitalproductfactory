import type { CrmTone } from "@/lib/crm/presentation";
import { StatusBadge } from "@/components/ui/report-kit";
import { CRM_TONE_INTENT } from "./crmToneIntent";

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
    <StatusBadge
      intent={CRM_TONE_INTENT[tone]}
      label={label}
      uppercase={false}
      className={["shrink-0", className].filter(Boolean).join(" ")}
    />
  );
}
