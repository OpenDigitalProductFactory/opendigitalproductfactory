import type { Intent } from "@/components/ui/report-kit";
import type { CrmTone } from "@/lib/crm/presentation";

export const CRM_TONE_INTENT: Record<CrmTone, Intent> = {
  accent: "accent",
  attention: "accent",
  danger: "danger",
  info: "info",
  neutral: "neutral",
  success: "success",
  warning: "warning",
};
