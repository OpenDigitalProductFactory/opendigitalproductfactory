import { describe, it, expect } from "vitest";
import { parseSurfaceView } from "./surface-view";

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
