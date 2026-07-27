import {
  getOperationsMapQuickViewFilters,
  OPERATIONS_MAP_QUICK_VIEWS,
} from "@/lib/ai-operations-map/project-events";
import type {
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
  OperationsMapProjectionFilters,
  OperationsMapProjectionSource,
  OperationsMapQuickViewId,
  OperationsMapSeverity,
} from "@/lib/ai-operations-map/types";

export const OPERATIONS_MAP_VIEW_PREFERENCE_KEY = "ai-operations-map:view";
export const OPERATIONS_MAP_SAVED_VIEWS_KEY = "ai-operations-map:saved-views";
export const OPERATIONS_MAP_A2A_PREFERENCE_KEY = "ai-operations-map:a2a";

export type A2aActorRole = "either" | "from" | "to";
export type A2aAuthorityFilter = "all" | "governed" | "ungoverned";

export type OperationsMapA2aFilterPreference = {
  types: OperationsMapA2aEdgeKind[];
  states: OperationsMapA2aInteractionState[];
  actorId: string;
  actorRole: A2aActorRole;
  authority: A2aAuthorityFilter;
};

const A2A_EDGE_KIND_VALUES: OperationsMapA2aEdgeKind[] = [
  "a2a-delegation",
  "a2a-handoff",
  "a2a-task-lineage",
  "a2a-deliberation",
];
const A2A_STATE_VALUES: OperationsMapA2aInteractionState[] = ["active", "completed", "failed", "blocked"];
const A2A_ACTOR_ROLES = new Set<A2aActorRole>(["either", "from", "to"]);
const A2A_AUTHORITY_FILTERS = new Set<A2aAuthorityFilter>(["all", "governed", "ungoverned"]);
const A2A_EDGE_KIND_SET = new Set<OperationsMapA2aEdgeKind>(A2A_EDGE_KIND_VALUES);
const A2A_STATE_SET = new Set<OperationsMapA2aInteractionState>(A2A_STATE_VALUES);

export function getDefaultA2aFilterPreference(): OperationsMapA2aFilterPreference {
  return {
    types: [...A2A_EDGE_KIND_VALUES],
    states: [...A2A_STATE_VALUES],
    actorId: "all",
    actorRole: "either",
    authority: "all",
  };
}

export function loadA2aFilterPreference(): OperationsMapA2aFilterPreference {
  try {
    const raw = localStorage.getItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY);
    if (!raw) return getDefaultA2aFilterPreference();

    const parsed = JSON.parse(raw) as Partial<OperationsMapA2aFilterPreference>;
    const types = Array.isArray(parsed.types)
      ? parsed.types.filter((value): value is OperationsMapA2aEdgeKind => A2A_EDGE_KIND_SET.has(value as OperationsMapA2aEdgeKind))
      : [];
    const states = Array.isArray(parsed.states)
      ? parsed.states.filter((value): value is OperationsMapA2aInteractionState => A2A_STATE_SET.has(value as OperationsMapA2aInteractionState))
      : [];
    const actorRole = A2A_ACTOR_ROLES.has(parsed.actorRole as A2aActorRole) ? (parsed.actorRole as A2aActorRole) : "either";
    const actorId = typeof parsed.actorId === "string" && parsed.actorId.trim() !== "" ? parsed.actorId : "all";
    const authority = A2A_AUTHORITY_FILTERS.has(parsed.authority as A2aAuthorityFilter) ? (parsed.authority as A2aAuthorityFilter) : "all";

    return {
      // Empty arrays mean "show all" rather than "hide everything" — a stored
      // empty filter must never blank the panel.
      types: types.length > 0 ? types : [...A2A_EDGE_KIND_VALUES],
      states: states.length > 0 ? states : [...A2A_STATE_VALUES],
      actorId,
      actorRole,
      authority,
    };
  } catch {
    return getDefaultA2aFilterPreference();
  }
}

export function saveA2aFilterPreference(preference: OperationsMapA2aFilterPreference): void {
  try {
    localStorage.setItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // localStorage can be unavailable or full; the control rail remains usable without persistence.
  }
}

export function clearA2aFilterPreference(): void {
  try {
    localStorage.removeItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY);
  } catch {
    // localStorage can be unavailable; resetting in-memory state still keeps the control rail usable.
  }
}

// ─── Operations Map dimension toggle (Provider routes · A2A · Both) ───────
// Lets the operator focus the map on provider routing, coworker-to-coworker
// (A2A) interactions, or both. Defaults to "both" (the full surface).

export const OPERATIONS_MAP_DIMENSION_KEY = "ai-operations-map:dimension";

export type OperationsMapDimension = "provider" | "a2a" | "both";

const OPERATIONS_MAP_DIMENSIONS = new Set<OperationsMapDimension>(["provider", "a2a", "both"]);

export function getDefaultOperationsMapDimension(): OperationsMapDimension {
  return "both";
}

export function loadOperationsMapDimension(): OperationsMapDimension {
  try {
    const raw = localStorage.getItem(OPERATIONS_MAP_DIMENSION_KEY);
    return OPERATIONS_MAP_DIMENSIONS.has(raw as OperationsMapDimension)
      ? (raw as OperationsMapDimension)
      : getDefaultOperationsMapDimension();
  } catch {
    return getDefaultOperationsMapDimension();
  }
}

export function saveOperationsMapDimension(dimension: OperationsMapDimension): void {
  try {
    localStorage.setItem(OPERATIONS_MAP_DIMENSION_KEY, dimension);
  } catch {
    // localStorage can be unavailable or full; the map remains usable without persistence.
  }
}

export function clearOperationsMapDimension(): void {
  try {
    localStorage.removeItem(OPERATIONS_MAP_DIMENSION_KEY);
  } catch {
    // localStorage can be unavailable; resetting in-memory state still keeps the map usable.
  }
}

export type OperationsMapStoredQuickViewId = OperationsMapQuickViewId | "custom";

export type OperationsMapViewPreference = {
  quickViewId: OperationsMapStoredQuickViewId;
  filters: OperationsMapProjectionFilters;
};

export type OperationsMapSavedView = {
  id: string;
  name: string;
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

export function loadOperationsMapSavedViews(): OperationsMapSavedView[] {
  try {
    const raw = localStorage.getItem(OPERATIONS_MAP_SAVED_VIEWS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isSavedView).map((view) => ({
      id: view.id,
      name: view.name,
      filters: {
        sources: [...view.filters.sources],
        severities: [...view.filters.severities],
      },
    }));
  } catch {
    return [];
  }
}

export function upsertOperationsMapSavedView(view: OperationsMapSavedView): void {
  const normalized = normalizeSavedView(view);
  if (!normalized) return;

  const existing = loadOperationsMapSavedViews();
  const next = [
    normalized,
    ...existing.filter((candidate) => candidate.id !== normalized.id),
  ];
  saveOperationsMapSavedViews(next);
}

export function deleteOperationsMapSavedView(viewId: string): void {
  const next = loadOperationsMapSavedViews().filter((view) => view.id !== viewId);
  saveOperationsMapSavedViews(next);
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

function saveOperationsMapSavedViews(views: OperationsMapSavedView[]): void {
  try {
    localStorage.setItem(OPERATIONS_MAP_SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // localStorage can be unavailable or full; saved views are an operator convenience.
  }
}

function normalizeSavedView(view: OperationsMapSavedView): OperationsMapSavedView | null {
  const id = view.id.trim();
  const name = view.name.trim();
  if (!id || !name || !isValidFilters(view.filters)) return null;

  return {
    id,
    name,
    filters: {
      sources: [...view.filters.sources],
      severities: [...view.filters.severities],
    },
  };
}

function isSavedView(value: unknown): value is OperationsMapSavedView {
  if (typeof value !== "object" || value === null) return false;
  const view = value as Partial<OperationsMapSavedView>;
  return typeof view.id === "string" && view.id.trim() !== ""
    && typeof view.name === "string" && view.name.trim() !== ""
    && isValidFilters(view.filters);
}
