import { ACTIVE_BACKLOG_STATUSES } from "@/lib/backlog-visibility";
import { OPEN_OPPORTUNITY_STAGES } from "@/lib/crm/presentation";

import type { DataSourceFilter } from "./types";

export interface PlatformDefaultDataLens {
  defaultLabel: string;
  allLabel: string;
  filter: DataSourceFilter;
}

export interface PlatformTableHomeSurface {
  path: string;
  label: string;
  board: boolean;
  /** Domain-owned dataset shown before a user applies presentation filters. */
  defaultDataLens?: PlatformDefaultDataLens;
}

const DEFAULT_DATA_LENSES: Partial<Record<string, PlatformDefaultDataLens>> = {
  backlog_item: {
    defaultLabel: "Active only",
    allLabel: "All items",
    filter: {
      conditions: [{
        field: "status",
        operator: "in",
        value: [...ACTIVE_BACKLOG_STATUSES],
      }],
      logic: "and",
    },
  },
  risk_assessment: activeLens("All assessments"),
  compliance_control: activeLens("All controls"),
  compliance_obligation: activeLens("All obligations"),
  opportunity: {
    defaultLabel: "Open only",
    allLabel: "All opportunities",
    filter: {
      conditions: [{
        field: "stage",
        operator: "in",
        value: [...OPEN_OPPORTUNITY_STAGES],
      }],
      logic: "and",
    },
  },
  customer_account: {
    defaultLabel: "Current only",
    allLabel: "All customers",
    filter: {
      conditions: [{ field: "status", operator: "neq", value: "superseded" }],
      logic: "and",
    },
  },
};

function activeLens(allLabel: string): PlatformDefaultDataLens {
  return {
    defaultLabel: "Active only",
    allLabel,
    filter: {
      conditions: [{ field: "status", operator: "eq", value: "active" }],
      logic: "and",
    },
  };
}

export function platformTableHomeSurface(
  entityType: string,
  path: string,
  label: string,
  board: boolean,
): PlatformTableHomeSurface {
  return {
    path,
    label,
    board,
    ...(DEFAULT_DATA_LENSES[entityType]
      ? { defaultDataLens: DEFAULT_DATA_LENSES[entityType] }
      : {}),
  };
}
