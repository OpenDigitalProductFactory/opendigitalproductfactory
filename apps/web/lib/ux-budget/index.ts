// apps/web/lib/ux-budget/index.ts
//
// L2 UX budget module — EP-UX-SYSTEM spec §6 L2 (BI-B9BE9A29).
//
// One source, three consumers: the numbers agents are told (L3), the CI checkers
// (L4/L4.5/L5), and the migration league table (§7.1). Import from here.

export {
  DISCLOSURE_ATTR,
  DISCLOSURE_TRIGGER_ATTR,
  LEAD_ATTR,
  countDisclosureRegions,
  defaultVisibleHtml,
  extractSubtrees,
  isDisclosureRegion,
  isStructurallyHidden,
  leadBandHtml,
  removeSubtrees,
  type TagToken,
} from "./scope";

export {
  PRIMARY_ACTION_ATTR,
  countPrimaryActions,
  countVisibleFields,
  maxChoicesPerControl,
  measureUxBudget,
  meetsReadingLevel,
  type UxBudgetMetrics,
} from "./measure";

export {
  AUDIENCE_READING_LEVELS,
  UX_BUDGETS,
  UX_SHELLS,
  budgetFor,
  readingLevelFor,
  type UxBudget,
  type UxShell,
} from "./budgets";

export {
  MIGRATED_ROUTES,
  PRE_MIGRATION_EXEMPT_CHECKS,
  shellForRoute,
  shellPolicyFor,
  type ExemptCheck,
  type RouteShellPolicy,
  type ShellClassifiable,
} from "./route-shells";

export {
  pagePurposeContractSchema,
  pagePurposeRegistrySchema,
  parsePagePurposeContract,
  parsePagePurposeRegistry,
  parsePurposeIdentityBaseline,
  purposeContractSourceSchema,
  purposeIdentityBaselineSchema,
  quarantinedPurposeContractSourceSchema,
  ratifiedPurposeContractSourceSchema,
  type DraftPurposeRecord,
  type PagePurposeContract,
  type PagePurposeRegistry,
  type PurposeContractSource,
  type QuarantinedPurposeRecord,
  type RatifiedPurposeContract,
  type RatifiedPurposeContractSource,
  type TaskValidationReceipt,
} from "./page-purpose";

export {
  PURPOSE_CONTRACT_SOURCES,
  buildPurposeContractSourceIndex,
  type PurposeContractModule,
} from "./purpose-contracts";

export {
  buildRoutePolicies,
  type RoutePolicy,
  type RoutePolicyManifestRow,
} from "./route-policy";

export {
  evaluateUxBudget,
  type BudgetFinding,
  type BudgetReport,
  type BudgetSeverity,
  type RouteStatus,
} from "./evaluate";

import { measureUxBudget } from "./measure";
import { evaluateUxBudget, type BudgetReport, type RouteStatus } from "./evaluate";
import type { UxShell } from "./budgets";
import type { RouteAudience } from "../navigation/route-audience";
import type { ExemptCheck } from "./route-shells";

/** Convenience: measure and evaluate a served-DOM HTML string in one call. */
export function auditUxBudget(
  html: string,
  shell: UxShell,
  options: {
    exemptChecks?: readonly ExemptCheck[];
    routeStatus?: RouteStatus;
    audience?: RouteAudience | null;
  } = {},
): BudgetReport {
  return evaluateUxBudget(measureUxBudget(html), shell, options);
}
