import { PRODUCT_INTELLIGENCE_WATCH_TASK_KIND } from "./product-intelligence-watch-contract";
import { PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND } from "./product-management-playbook";

export const PRODUCT_SCHEDULED_TASK_KINDS = [
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
  PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
] as const;
