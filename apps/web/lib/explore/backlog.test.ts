import { describe, it, expect } from "vitest";
import {
  validateBacklogInput,
  validateEpicInput,
  BACKLOG_STATUS_COLOURS,
  EPIC_STATUS_COLOURS,
  EPIC_STATUSES,
  FEDERATION_SYNCABLE_BACKLOG_STATUSES,
  isFederationSyncableBacklogStatus,
  LIFECYCLE_STAGE_LABELS,
  initialDemandStageForInput,
  type BacklogItemInput,
  type EpicInput,
} from "./backlog";

describe("validateBacklogInput()", () => {
  it("returns null for a valid portfolio-type item", () => {
    const input: BacklogItemInput = { title: "My item", type: "portfolio", workType: "feature", status: "open" };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error string for a product-type item missing a product target", () => {
    const input: BacklogItemInput = { title: "My item", type: "product", workType: "feature", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/business product or digital product/i);
  });

  it("accepts a business Product without fabricating a DigitalProduct", () => {
    const input: BacklogItemInput = {
      title: "Improve private events",
      type: "product",
      workType: "feature",
      status: "open",
      organizationId: "org-1",
      businessProductId: "product-events",
    };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("rejects conflicting business and digital targets", () => {
    const input: BacklogItemInput = {
      title: "Ambiguous demand",
      type: "product",
      workType: "feature",
      status: "open",
      organizationId: "org-1",
      businessProductId: "product-events",
      digitalProductId: "digital-booking",
    };
    expect(validateBacklogInput(input)).toMatch(/choose one/i);
  });

  it("returns null for a valid product-type item with digitalProductId", () => {
    const input: BacklogItemInput = {
      title: "My item",
      type: "product",
      workType: "feature",
      status: "open",
      digitalProductId: "clxabc123",
    };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error for a blank title", () => {
    const input: BacklogItemInput = { title: "   ", type: "portfolio", workType: "feature", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/title/i);
  });
});

describe("initialDemandStageForInput()", () => {
  it("enters newly scoped product demand into raw intake explicitly", () => {
    expect(initialDemandStageForInput({ businessProductId: "product-1" })).toBe(
      "raw",
    );
    expect(initialDemandStageForInput({ digitalProductId: "digital-1" })).toBe(
      "raw",
    );
  });

  it("does not classify unscoped or explicitly legacy demand", () => {
    expect(initialDemandStageForInput({})).toBeNull();
    expect(
      initialDemandStageForInput({
        digitalProductId: "digital-1",
        demandStage: null,
      }),
    ).toBeNull();
  });

  it("does not let a creation caller skip the activation lifecycle", () => {
    const input: BacklogItemInput = {
      title: "Pre-funded request",
      type: "product",
      workType: "feature",
      status: "open",
      organizationId: "org-1",
      businessProductId: "product-1",
      demandStage: "ready",
    };

    expect(validateBacklogInput(input)).toMatch(/must enter at raw/i);
  });
});

describe("BACKLOG_STATUS_COLOURS", () => {
  it("has a colour for every expected status", () => {
    expect(BACKLOG_STATUS_COLOURS["open"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["in-progress"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["done"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["deferred"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["retired"]).toBeDefined();
  });
});

describe("LIFECYCLE_STAGE_LABELS", () => {
  it("has a label for every stage", () => {
    for (const stage of ["plan", "design", "build", "production", "retirement"]) {
      expect(LIFECYCLE_STAGE_LABELS[stage]).toBeDefined();
    }
  });
});

describe("isFederationSyncableBacklogStatus()", () => {
  it("treats open work (triaging/open/in-progress) as syncable", () => {
    expect(FEDERATION_SYNCABLE_BACKLOG_STATUSES).toEqual(["triaging", "open", "in-progress"]);
    for (const status of FEDERATION_SYNCABLE_BACKLOG_STATUSES) {
      expect(isFederationSyncableBacklogStatus(status)).toBe(true);
    }
  });

  it("treats closed work (done) and paused work (deferred) as not syncable", () => {
    expect(isFederationSyncableBacklogStatus("done")).toBe(false);
    expect(isFederationSyncableBacklogStatus("deferred")).toBe(false);
  });

  it("returns false for an unknown status rather than defaulting to syncable", () => {
    expect(isFederationSyncableBacklogStatus("bogus")).toBe(false);
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
