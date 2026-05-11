import {
  getOperationsMapQuickViewFilters,
  OPERATIONS_MAP_QUICK_VIEWS,
} from "@/lib/ai-operations-map/project-events";
import type {
  OperationsMapProjectionFilters,
  OperationsMapProjectionSource,
  OperationsMapQuickViewId,
  OperationsMapSeverity,
} from "@/lib/ai-operations-map/types";

export const OPERATIONS_MAP_VIEW_PREFERENCE_KEY = "ai-operations-map:view";

export type OperationsMapStoredQuickViewId = OperationsMapQuickViewId | "custom";

export type OperationsMapViewPreference = {
  quickViewId: OperationsMapStoredQuickViewId;
  filters: OperationsMapProjectionFilters;
};

const ALL_QUICK_VIEW_IDS = new Set<OperationsMapQuickViewId>(OPERATIONS_MAP_QUICK_VIEWS.map((view) => view.id));
const ALL_SOURCES = new Set<OperationsMapProjectionSource>(getOperationsMapQuickViewFilters("all").sources);
const ALL_SEVERITIES = new Set<OperationsMapSeverity>(getOperationsMapQuickViewFilters("all").severities);

export function getDefaultOperationsMapViewPreference(): OperationsMapViewPreference {
  return {
    quickViewId: "all",
    filters: getOperationsMapQuickViewFilters("all"),
  };
}

export function loadOperationsMapViewPreference(): OperationsMapViewPreference {
  try {
    const raw = localStorage.getItem(OPERATIONS_MAP_VIEW_PREFERENCE_KEY);
    if (!raw) return getDefaultOperationsMapViewPreference();

    const parsed = JSON.parse(raw) as Partial<OperationsMapViewPreference>;
    if (!isStoredQuickViewId(parsed.quickViewId) || !isValidFilters(parsed.filters)) {
      return getDefaultOperationsMapViewPreference();
    }

    return {
      quickViewId: parsed.quickViewId,
      filters: {
        sources: [...parsed.filters.sources],
        severities: [...parsed.filters.severities],
      },
    };
  } catch {
    return getDefaultOperationsMapViewPreference();
  }
}

export function saveOperationsMapViewPreference(preference: OperationsMapViewPreference): void {
  try {
    localStorage.setItem(OPERATIONS_MAP_VIEW_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // localStorage can be unavailable or full; the map remains usable without persistence.
  }
}

export function clearOperationsMapViewPreference(): void {
  try {
    localStorage.removeItem(OPERATIONS_MAP_VIEW_PREFERENCE_KEY);
  } catch {
    // localStorage can be unavailable; resetting in-memory state still keeps the map usable.
  }
}

function isStoredQuickViewId(value: unknown): value is OperationsMapStoredQuickViewId {
  return value === "custom" || (typeof value === "string" && ALL_QUICK_VIEW_IDS.has(value as OperationsMapQuickViewId));
}

function isValidFilters(value: unknown): value is OperationsMapProjectionFilters {
  if (typeof value !== "object" || value === null) return false;
  const filters = value as Partial<OperationsMapProjectionFilters>;
  if (!Array.isArray(filters.sources) || !Array.isArray(filters.severities)) return false;
  if (filters.sources.length === 0 || filters.severities.length === 0) return false;

  return (
    filters.sources.every((source): source is OperationsMapProjectionSource => ALL_SOURCES.has(source)) &&
    filters.severities.every((severity): severity is OperationsMapSeverity => ALL_SEVERITIES.has(severity))
  );
}
