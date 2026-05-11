import { beforeEach, describe, expect, it } from "vitest";
import { getOperationsMapQuickViewFilters } from "@/lib/ai-operations-map/project-events";
import {
  clearOperationsMapViewPreference,
  loadOperationsMapViewPreference,
  OPERATIONS_MAP_VIEW_PREFERENCE_KEY,
  saveOperationsMapViewPreference,
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
});
