import { MARKETING_CAMPAIGN_EXECUTION_TOOL_NAMES } from "@dpf/db/coworker-service-backing";

// This intentionally starts with the first behaviorally verified service.
// Catalog tools not in this list fail readiness closed until their own parity
// and live execution evidence lands.
export const VERIFIED_COWORKER_SERVICE_TOOL_NAMES: readonly string[] =
  MARKETING_CAMPAIGN_EXECUTION_TOOL_NAMES;
