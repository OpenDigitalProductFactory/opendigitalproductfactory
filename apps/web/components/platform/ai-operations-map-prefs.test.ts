import { beforeEach, describe, expect, it } from "vitest";
import { getOperationsMapQuickViewFilters } from "@/lib/ai-operations-map/project-events";
import {
  clearA2aFilterPreference,
  clearOperationsMapViewPreference,
  deleteOperationsMapSavedView,
  getDefaultA2aFilterPreference,
  loadA2aFilterPreference,
  loadOperationsMapViewPreference,
  loadOperationsMapSavedViews,
  OPERATIONS_MAP_A2A_PREFERENCE_KEY,
  OPERATIONS_MAP_SAVED_VIEWS_KEY,
  OPERATIONS_MAP_VIEW_PREFERENCE_KEY,
  saveA2aFilterPreference,
  saveOperationsMapViewPreference,
  upsertOperationsMapSavedView,
} from "./ai-operations-map-prefs";

const store = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

describe("AI operations map preferences", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
    localStorageMock.clear();
  });

  it("defaults to the all-activity quick view when no preference exists", () => {
    expect(loadOperationsMapViewPreference()).toEqual({
      quickViewId: "all",
      filters: getOperationsMapQuickViewFilters("all"),
    });
  });

  it("stores the active quick view and filter state", () => {
    const filters = getOperationsMapQuickViewFilters("exceptions");

    saveOperationsMapViewPreference({ quickViewId: "exceptions", filters });

    expect(loadOperationsMapViewPreference()).toEqual({ quickViewId: "exceptions", filters });
    expect(store.has(OPERATIONS_MAP_VIEW_PREFERENCE_KEY)).toBe(true);
  });

  it("stores custom filter state separately from quick-view presets", () => {
    saveOperationsMapViewPreference({
      quickViewId: "custom",
      filters: {
        sources: ["tool-execution"],
        severities: ["warning", "critical"],
      },
    });

    expect(loadOperationsMapViewPreference()).toEqual({
      quickViewId: "custom",
      filters: {
        sources: ["tool-execution"],
        severities: ["warning", "critical"],
      },
    });
  });

  it("ignores invalid stored preferences", () => {
    store.set(OPERATIONS_MAP_VIEW_PREFERENCE_KEY, JSON.stringify({
      quickViewId: "missing",
      filters: {
        sources: ["unknown"],
        severities: ["normal"],
      },
    }));

    expect(loadOperationsMapViewPreference()).toEqual({
      quickViewId: "all",
      filters: getOperationsMapQuickViewFilters("all"),
    });
  });

  it("clears stored preferences back to the default view", () => {
    saveOperationsMapViewPreference({
      quickViewId: "custom",
      filters: {
        sources: ["tool-execution"],
        severities: ["warning"],
      },
    });

    clearOperationsMapViewPreference();

    expect(store.has(OPERATIONS_MAP_VIEW_PREFERENCE_KEY)).toBe(false);
    expect(loadOperationsMapViewPreference()).toEqual({
      quickViewId: "all",
      filters: getOperationsMapQuickViewFilters("all"),
    });
  });

  it("defaults saved operator views to an empty list", () => {
    expect(loadOperationsMapSavedViews()).toEqual([]);
  });

  it("adds and updates saved operator views", () => {
    upsertOperationsMapSavedView({
      id: "failed-tools",
      name: "Failed tool runs",
      filters: {
        sources: ["tool-execution"],
        severities: ["warning", "critical"],
      },
    });
    upsertOperationsMapSavedView({
      id: "failed-tools",
      name: "Failed tool activity",
      filters: {
        sources: ["task-run", "tool-execution"],
        severities: ["attention", "warning", "critical"],
      },
    });

    expect(loadOperationsMapSavedViews()).toEqual([
      {
        id: "failed-tools",
        name: "Failed tool activity",
        filters: {
          sources: ["task-run", "tool-execution"],
          severities: ["attention", "warning", "critical"],
        },
      },
    ]);
    expect(store.has(OPERATIONS_MAP_SAVED_VIEWS_KEY)).toBe(true);
  });

  it("deletes saved operator views by id", () => {
    upsertOperationsMapSavedView({
      id: "evidence-only",
      name: "Evidence only",
      filters: getOperationsMapQuickViewFilters("evidence"),
    });

    deleteOperationsMapSavedView("evidence-only");

    expect(loadOperationsMapSavedViews()).toEqual([]);
  });

  it("ignores invalid saved operator views from storage", () => {
    store.set(OPERATIONS_MAP_SAVED_VIEWS_KEY, JSON.stringify([
      {
        id: "valid",
        name: "Valid",
        filters: {
          sources: ["tool-execution"],
          severities: ["normal"],
        },
      },
      {
        id: "",
        name: "Missing id",
        filters: {
          sources: ["tool-execution"],
          severities: ["normal"],
        },
      },
      {
        id: "bad-source",
        name: "Bad source",
        filters: {
          sources: ["unknown"],
          severities: ["normal"],
        },
      },
    ]));

    expect(loadOperationsMapSavedViews()).toEqual([
      {
        id: "valid",
        name: "Valid",
        filters: {
          sources: ["tool-execution"],
          severities: ["normal"],
        },
      },
    ]);
  });

  it("defaults the A2A filter preference to all types and states", () => {
    expect(loadA2aFilterPreference()).toEqual(getDefaultA2aFilterPreference());
    expect(loadA2aFilterPreference().actorId).toBe("all");
  });

  it("round-trips the A2A filter preference through storage", () => {
    saveA2aFilterPreference({
      types: ["a2a-delegation", "a2a-handoff"],
      states: ["failed", "blocked"],
      actorId: "brand-analyst",
      actorRole: "to",
    });

    expect(store.has(OPERATIONS_MAP_A2A_PREFERENCE_KEY)).toBe(true);
    expect(loadA2aFilterPreference()).toEqual({
      types: ["a2a-delegation", "a2a-handoff"],
      states: ["failed", "blocked"],
      actorId: "brand-analyst",
      actorRole: "to",
    });
  });

  it("treats a stored empty A2A filter as show-all and drops unknown values", () => {
    store.set(
      OPERATIONS_MAP_A2A_PREFERENCE_KEY,
      JSON.stringify({ types: ["bogus"], states: [], actorId: "x", actorRole: "sideways" }),
    );
    const loaded = loadA2aFilterPreference();
    expect(loaded.types).toEqual(["a2a-delegation", "a2a-handoff", "a2a-task-lineage", "a2a-deliberation"]);
    expect(loaded.states).toEqual(["active", "completed", "failed", "blocked"]);
    expect(loaded.actorRole).toBe("either");
    expect(loaded.actorId).toBe("x");
  });

  it("clears the A2A filter preference", () => {
    saveA2aFilterPreference(getDefaultA2aFilterPreference());
    clearA2aFilterPreference();
    expect(store.has(OPERATIONS_MAP_A2A_PREFERENCE_KEY)).toBe(false);
  });
});
