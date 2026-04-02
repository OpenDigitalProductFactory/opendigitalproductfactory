import { describe, it, expect } from "vitest";
import {
  validateBacklogInput,
  validateEpicInput,
  BACKLOG_STATUS_COLOURS,
  EPIC_STATUS_COLOURS,
  EPIC_STATUSES,
  LIFECYCLE_STAGE_LABELS,
  type BacklogItemInput,
  type EpicInput,
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

describe("EPIC_STATUSES", () => {
  it("contains exactly open, in-progress, done", () => {
    expect(EPIC_STATUSES).toContain("open");
    expect(EPIC_STATUSES).toContain("in-progress");
    expect(EPIC_STATUSES).toContain("done");
    expect(EPIC_STATUSES).toHaveLength(3);
  });
});

describe("validateEpicInput()", () => {
  it("returns null for a valid epic", () => {
    const input: EpicInput = {
      title: "My epic",
      status: "open",
      portfolioIds: [],
    };
    expect(validateEpicInput(input)).toBeNull();
  });

  it("returns an error for blank title", () => {
    const input: EpicInput = { title: "   ", status: "open", portfolioIds: [] };
    expect(validateEpicInput(input)).toMatch(/title/i);
  });

  it("returns an error for invalid status", () => {
    const input = { title: "My epic", status: "invalid", portfolioIds: [] } as unknown as EpicInput;
    expect(validateEpicInput(input)).toMatch(/status/i);
  });
});

describe("EPIC_STATUS_COLOURS", () => {
  it("has a colour for every EPIC_STATUS", () => {
    for (const s of EPIC_STATUSES) {
      expect(EPIC_STATUS_COLOURS[s]).toBeDefined();
    }
  });
});
