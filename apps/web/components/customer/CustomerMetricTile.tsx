import type { CrmTone } from "@/lib/crm/presentation";
import { StatCard } from "@/components/ui/report-kit";
import { CRM_TONE_INTENT } from "./crmToneIntent";

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
  return (
    <StatCard
      href={href}
      label={label}
      value={value}
      hint={detail}
      intent={CRM_TONE_INTENT[tone]}
      className="h-full"
    />
  );
}
