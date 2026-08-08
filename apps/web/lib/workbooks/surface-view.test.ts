import { describe, it, expect } from "vitest";
import {
  buildSurfaceViewHref,
  parseSurfaceDataScope,
  parseSurfaceView,
  resolveSurfaceDataFilter,
} from "./surface-view";
import { ACTIVE_BACKLOG_STATUSES } from "@/lib/backlog-visibility";

describe("parseSurfaceView", () => {
  it("accepts grid and board", () => {
    expect(parseSurfaceView("grid")).toBe("grid");
    expect(parseSurfaceView("board")).toBe("board");
  });

  it("returns null for list, unknown, undefined, and null", () => {
    expect(parseSurfaceView("list")).toBeNull();
    expect(parseSurfaceView("kanban")).toBeNull();
    expect(parseSurfaceView(undefined)).toBeNull();
    expect(parseSurfaceView(null)).toBeNull();
    expect(parseSurfaceView("")).toBeNull();
  });
});

describe("page-to-grid data scope (BI-9DB20C39)", () => {
  const activeFilter = {
    conditions: [
      { field: "status", operator: "in" as const, value: [...ACTIVE_BACKLOG_STATUSES] },
    ],
    logic: "and" as const,
  };

  it("defaults absent and unknown scope values to the domain lens", () => {
    expect(parseSurfaceDataScope(undefined)).toBe("default");
    expect(parseSurfaceDataScope(null)).toBe("default");
    expect(parseSurfaceDataScope("closed")).toBe("default");
  });

  it("accepts only the explicit all-records override", () => {
    expect(parseSurfaceDataScope("all")).toBe("all");
    expect(resolveSurfaceDataFilter(activeFilter, "all")).toBeUndefined();
    expect(resolveSurfaceDataFilter(activeFilter, "default")).toEqual(activeFilter);
  });

  it("builds stable server-readable List, Grid, Board, and all-records URLs", () => {
    expect(buildSurfaceViewHref("/ops", "list", "default")).toBe("/ops");
    expect(buildSurfaceViewHref("/ops", "grid", "default")).toBe("/ops?view=grid");
    expect(buildSurfaceViewHref("/ops", "board", "default")).toBe("/ops?view=board");
    expect(buildSurfaceViewHref("/ops", "grid", "all")).toBe("/ops?view=grid&dataScope=all");
  });
});
