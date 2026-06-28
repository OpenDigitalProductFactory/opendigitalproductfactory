import type { WorkCaseDecisionScope } from "./source-registry";
import { getWorkCaseSourceEntry } from "./source-registry";
import type { WorkspaceWorkCaseListItem } from "./workspace-case-loader";

export type CustomerWorkCaseLaneId =
  | "customer-service"
  | "revenue-work"
  | "general-customer-work";

export interface CustomerDomainWorkCaseRef {
  caseId: string;
  title: string;
  href: string;
  sourceLabel: string;
  state: WorkspaceWorkCaseListItem["state"];
  nextAction: string;
  attentionRequired: boolean;
}

export interface CustomerDomainWorkCaseLane {
  laneId: CustomerWorkCaseLaneId;
  label: string;
  decisionScope: WorkCaseDecisionScope;
  caseCount: number;
  attentionCount: number;
  cases: CustomerDomainWorkCaseRef[];
}

export interface CustomerDomainWorkCaseAdoptionView {
  totalCases: number;
  attentionCount: number;
  lanes: CustomerDomainWorkCaseLane[];
}

const LANE_LABELS: Record<CustomerWorkCaseLaneId, string> = {
  "customer-service": "Customer service",
  "revenue-work": "Revenue work",
  "general-customer-work": "Customer work",
};

const LANE_ORDER: CustomerWorkCaseLaneId[] = [
  "customer-service",
  "revenue-work",
  "general-customer-work",
];

function sourceTypeFor(item: WorkspaceWorkCaseListItem): string | null {
  const sourceRef = item.sourceRefs.find((ref) => ref.kind === "source" && ref.sourceType);
  if (sourceRef?.sourceType) return sourceRef.sourceType;
  const separator = item.caseId.indexOf(":");
  return separator > 0 ? item.caseId.slice(0, separator) : null;
}

function laneForSource(sourceType: string): CustomerWorkCaseLaneId | null {
  const entry = getWorkCaseSourceEntry(sourceType);
  if (!entry || entry.defaultDecisionScope !== "wwwd") return null;
  switch (entry.sourceKey) {
    case "booking":
    case "storefront-booking":
    case "activity":
      return "customer-service";
    case "opportunity":
    case "engagement":
      return "revenue-work";
    default:
      return entry.domainCategory.startsWith("customer") ? "general-customer-work" : null;
  }
}

function toCaseRef(item: WorkspaceWorkCaseListItem): CustomerDomainWorkCaseRef {
  return {
    caseId: item.caseId,
    title: item.title,
    href: item.href,
    sourceLabel: item.sourceLabel,
    state: item.state,
    nextAction: item.nextAction,
    attentionRequired: item.attentionRequired,
  };
}

export function buildCustomerDomainWorkCaseAdoption(
  cases: readonly WorkspaceWorkCaseListItem[],
): CustomerDomainWorkCaseAdoptionView {
  const grouped = new Map<CustomerWorkCaseLaneId, CustomerDomainWorkCaseRef[]>();

  for (const item of cases) {
    const sourceType = sourceTypeFor(item);
    const laneId = sourceType ? laneForSource(sourceType) : null;
    if (!laneId) continue;
    const laneCases = grouped.get(laneId) ?? [];
    laneCases.push(toCaseRef(item));
    grouped.set(laneId, laneCases);
  }

  const lanes = LANE_ORDER.flatMap((laneId): CustomerDomainWorkCaseLane[] => {
    const laneCases = grouped.get(laneId) ?? [];
    if (laneCases.length === 0) return [];
    return [{
      laneId,
      label: LANE_LABELS[laneId],
      decisionScope: "wwwd",
      caseCount: laneCases.length,
      attentionCount: laneCases.filter((item) => item.attentionRequired).length,
      cases: laneCases,
    }];
  });

  return {
    totalCases: lanes.reduce((total, lane) => total + lane.caseCount, 0),
    attentionCount: lanes.reduce((total, lane) => total + lane.attentionCount, 0),
    lanes,
  };
}
