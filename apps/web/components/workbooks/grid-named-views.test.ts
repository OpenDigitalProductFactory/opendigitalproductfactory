import { describe, it, expect } from "vitest";
import {
  upsertNamedView,
  removeNamedView,
  setDefaultNamedView,
  defaultNamedView,
  serializeNamedViews,
  parseNamedViews,
  normalizeViewState,
  type NamedView,
} from "./grid-named-views";
import type { GridViewState } from "./grid-view-state";

const baseState = (over: Partial<GridViewState> = {}): GridViewState =>
  normalizeViewState({ groupBy: ["status"], ...over });

const view = (id: string, name: string, over: Partial<GridViewState> = {}): NamedView => ({
  viewId: id,
  name,
  state: baseState(over),
});

describe("upsertNamedView", () => {
  it("appends a new view", () => {
    const out = upsertNamedView([], "My open bugs", baseState(), "lv-1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ viewId: "lv-1", name: "My open bugs" });
  });

  it("overwrites an existing view with the same name (case-insensitive), keeping its id", () => {
    const views = [view("lv-1", "By Owner")];
    const out = upsertNamedView(views, "by owner", baseState({ groupBy: ["owner"] }), "lv-2");
    expect(out).toHaveLength(1);
    expect(out[0]!.viewId).toBe("lv-1"); // kept
    expect(out[0]!.name).toBe("by owner"); // renamed to the new trimmed input
    expect(out[0]!.state.groupBy).toEqual(["owner"]); // state replaced
  });

  it("trims the name", () => {
    const out = upsertNamedView([], "  Spaced  ", baseState(), "lv-1");
    expect(out[0]!.name).toBe("Spaced");
  });

  it("does not mutate the input array", () => {
    const views = [view("lv-1", "A")];
    upsertNamedView(views, "B", baseState(), "lv-2");
    expect(views).toHaveLength(1);
  });
});

describe("removeNamedView", () => {
  it("removes by id", () => {
    const views = [view("lv-1", "A"), view("lv-2", "B")];
    expect(removeNamedView(views, "lv-1").map((v) => v.viewId)).toEqual(["lv-2"]);
  });
});

describe("setDefaultNamedView / defaultNamedView", () => {
  it("marks exactly one view default and clears the rest", () => {
    const views = [view("lv-1", "A"), view("lv-2", "B"), view("lv-3", "C")];
    const out = setDefaultNamedView(setDefaultNamedView(views, "lv-1"), "lv-3");
    expect(out.filter((v) => v.isDefault).map((v) => v.viewId)).toEqual(["lv-3"]);
    expect(defaultNamedView(out)!.viewId).toBe("lv-3");
  });

  it("clears all defaults when given null", () => {
    const views = setDefaultNamedView([view("lv-1", "A")], "lv-1");
    expect(defaultNamedView(setDefaultNamedView(views, null))).toBeUndefined();
  });
});

describe("serialize / parse round-trip", () => {
  it("round-trips views through localStorage serialization", () => {
    const views = setDefaultNamedView(
      [view("lv-1", "Open", { groupBy: ["status"] }), view("lv-2", "By owner", { groupBy: ["owner"] })],
      "lv-2",
    );
    const parsed = parseNamedViews(serializeNamedViews(views));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.state.groupBy).toEqual(["status"]);
    expect(defaultNamedView(parsed)!.viewId).toBe("lv-2");
  });

  it("returns [] for null / malformed input, never throws", () => {
    expect(parseNamedViews(null)).toEqual([]);
    expect(parseNamedViews("not json")).toEqual([]);
    expect(parseNamedViews('{"not":"an array"}')).toEqual([]);
  });

  it("drops entries missing viewId/name or with an unparseable state", () => {
    const raw = JSON.stringify([
      { name: "no id", state: "{}" },
      { viewId: "lv-9", state: "{}" }, // no name
      { viewId: "lv-1", name: "ok", state: "{}" },
    ]);
    const parsed = parseNamedViews(raw);
    expect(parsed.map((v) => v.viewId)).toEqual(["lv-1"]);
  });

  it("accepts a server view whose `state` is an object (not a serialized string)", () => {
    const raw = JSON.stringify([
      { viewId: "VW-abc", name: "Server view", state: { groupBy: ["status"], showFooter: true } },
    ]);
    const parsed = parseNamedViews(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.state.groupBy).toEqual(["status"]);
    expect(parsed[0]!.state.showFooter).toBe(true);
  });
});

describe("normalizeViewState", () => {
  it("fills every field with a baseline default so a view fully resets the grid", () => {
    const s = normalizeViewState({ groupBy: ["x"] });
    expect(s.filterQuery).toBe("");
    expect(s.sort).toEqual([]);
    expect(s.hiddenColumns).toEqual([]);
    expect(s.frozenCount).toBe(0);
    expect(s.rowHeight).toBe("medium");
    expect(s.showFooter).toBe(false);
    expect(s.groupBy).toEqual(["x"]);
  });
});
