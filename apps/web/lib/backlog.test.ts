import { describe, it, expect } from "vitest";
import {
  validateBacklogInput,
  BACKLOG_STATUS_COLOURS,
  LIFECYCLE_STAGE_LABELS,
  type BacklogItemInput,
} from "./backlog";

describe("validateBacklogInput()", () => {
  it("returns null for a valid portfolio-type item", () => {
    const input: BacklogItemInput = { title: "My item", type: "portfolio", status: "open" };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error string for a product-type item missing digitalProductId", () => {
    const input: BacklogItemInput = { title: "My item", type: "product", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/digital product/i);
  });

  it("returns null for a valid product-type item with digitalProductId", () => {
    const input: BacklogItemInput = {
      title: "My item",
      type: "product",
      status: "open",
      digitalProductId: "clxabc123",
    };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error for a blank title", () => {
    const input: BacklogItemInput = { title: "   ", type: "portfolio", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/title/i);
  });
});

describe("BACKLOG_STATUS_COLOURS", () => {
  it("has a colour for every expected status", () => {
    expect(BACKLOG_STATUS_COLOURS["open"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["in-progress"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["done"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["deferred"]).toBeDefined();
  });
});

describe("LIFECYCLE_STAGE_LABELS", () => {
  it("has a label for every stage", () => {
    for (const stage of ["plan", "design", "build", "production", "retirement"]) {
      expect(LIFECYCLE_STAGE_LABELS[stage]).toBeDefined();
    }
  });
});
