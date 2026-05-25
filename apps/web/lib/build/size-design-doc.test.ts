// apps/web/lib/build/size-design-doc.test.ts
//
// Coverage for Phase 2 deterministic sizing counter.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import { describe, expect, it } from "vitest";

import type { BuildDesignDoc } from "@/lib/explore/feature-build-types";

import {
  DEFAULT_SIZE_THRESHOLDS,
  sizeDesignDoc,
} from "./size-design-doc";

const FIXED_NOW = () => new Date("2026-05-24T20:00:00.000Z");

describe("sizeDesignDoc — null/empty safety", () => {
  it("treats undefined doc as ok with informational rationale", () => {
    const result = sizeDesignDoc(undefined, {}, FIXED_NOW);
    expect(result.decision).toBe("ok");
    expect(result.breakdown.acs.count).toBe(0);
    expect(result.trips).toHaveLength(0);
    expect(result.rationale).toMatch(/No design doc supplied/);
    expect(result.assessedAt).toBe("2026-05-24T20:00:00.000Z");
  });

  it("treats null doc as ok", () => {
    const result = sizeDesignDoc(null, {}, FIXED_NOW);
    expect(result.decision).toBe("ok");
  });

  it("returns thresholds (echoed) for audit", () => {
    const result = sizeDesignDoc(undefined, {}, FIXED_NOW);
    expect(result.thresholds).toEqual(DEFAULT_SIZE_THRESHOLDS);
  });
});

describe("sizeDesignDoc — small design (ok)", () => {
  it("scores a 1-button feature as ok", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "Customers cannot mark their favourite truck.",
      reusePlan: "Reuse existing TruckCard component.",
      proposedApproach:
        "Add a star icon button to the TruckCard. Persist via existing /api/preferences endpoint.",
      acceptanceCriteria: [
        "Star icon appears on truck cards.",
        "Clicking star toggles favourite status.",
        "Favourite persists across sessions.",
      ],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.decision).toBe("ok");
    expect(result.breakdown.acs.count).toBe(3);
    expect(result.trips).toHaveLength(0);
    expect(result.rationale).toMatch(/fits one Plan/);
  });
});

describe("sizeDesignDoc — medium design (decompose-recommended)", () => {
  it("trips recommend tier on 3 models", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "Add basic customer notes.",
      dataModel:
        "## Models\n- CustomerNote: per-customer freeform notes.\n- NoteTag: classification.\n- NoteAttachment: file references.",
      reusePlan: "Reuse existing customer detail page.",
      proposedApproach: "Add /api/customer/:id/notes GET and POST endpoints.",
      acceptanceCriteria: [
        "Notes list under each customer.",
        "Add note inline.",
        "Edit note inline.",
        "Delete note (soft).",
      ],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.decision).toBe("decompose-recommended");
    expect(result.breakdown.models.count).toBeGreaterThanOrEqual(3);
    const modelTrip = result.trips.find((t) => t.dimension === "models");
    expect(modelTrip?.level).toBe("recommend");
    expect(result.rationale).toMatch(/large/);
  });
});

describe("sizeDesignDoc — Dale truck-parts (decompose-required)", () => {
  // This fixture mirrors §1.1 of the spec — the empirical anchor.
  // Dale's design as produced by Ideate (FB-6F7D6AC4):
  //   5 new database models, 2 API surfaces, mobile-first UI with low-stock
  //   badges, authorization layer, idempotency + optimistic-locking +
  //   append-only ledger + multi-tenant isolation ACs.
  // Phase 2 must score this as `decompose-required` so Phase 3's gate (when
  // it ships) will fire.

  const daleDoc: BuildDesignDoc = {
    problemStatement:
      "HVAC technicians waste billable hours driving back to the warehouse because nobody can see what parts are currently stocked on each truck. Dale wants a way for techs to look up their truck inventory and update it when they use parts.",
    dataModel: [
      "## Data model",
      "- MobileInventoryLocationType: classification (Truck, Van, Warehouse).",
      "- MobileInventoryLocation: a specific physical location (one row per truck).",
      "- InventoryItem: catalog of part SKUs the shop stocks.",
      "- LocationInventory: current quantity of each item at each location.",
      "- InventoryTransaction: append-only ledger of every usage event.",
    ].join("\n"),
    reusePlan: "No existing inventory model in the storefront-template substrate.",
    proposedApproach: [
      "Two API surfaces: `/api/my-inventory` (GET list, GET :locationId detail) and `/api/inventory/usage` (POST). Mobile-first UI with truck cards, low-stock badges, and a usage-recording screen. Routes: `/my-inventory` (page) and `/dispatch` (page). Authorization layer enforces multi-tenant isolation on every read and write.",
    ].join("\n"),
    acceptanceCriteria: [
      "Techs see their truck's current inventory list.",
      "Inventory list shows item name, quantity, low-stock indicator.",
      "Tech can record usage of a part during a job.",
      "Usage POST is idempotent on the (truck, item, jobId) tuple.",
      "Usage POST uses optimistic locking to avoid race conditions.",
      "All inventory mutations append to the InventoryTransaction ledger.",
      "Ledger is append-only — no UPDATE or DELETE allowed at DB level.",
      "Multi-tenant isolation: tech A cannot see tech B's other-shop trucks.",
      "Dispatcher sees roll-up of low-stock items across all trucks.",
      "Low-stock threshold is configurable per item.",
      "Low-stock alerts deduplicate within a 4-hour window.",
      "Audit log records every read of inventory.",
      "Audit trail is queryable by inventory specialist.",
      "Rate limit usage POST to 60 per minute per tech.",
      "Background job reconciles ledger weekly.",
      "Mobile UI: truck card on /my-inventory.",
      "Mobile UI: usage-record screen accessible from card.",
      "Mobile UI: low-stock badge visible on each item row.",
      "Mobile UI: tap to call dispatch from low-stock view.",
      "Mobile UI: offline queue for usage POST when truck has no signal.",
      "Mobile UI: pull-to-refresh on inventory list.",
      "Dispatch view: filterable by truck.",
      "Dispatch view: sortable by low-stock count.",
      "Dispatch view: drill into per-truck history.",
      "Dispatch view: export to CSV.",
    ],
    accessibility: "Mobile UI must be operable one-handed; minimum tap target 44px.",
  };

  it("trips required threshold on the Dale design", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.decision).toBe("decompose-required");
  });

  it("trips required on models (5 detected, threshold 5)", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.breakdown.models.count).toBeGreaterThanOrEqual(5);
    const trip = result.trips.find(
      (t) => t.dimension === "models" && t.level === "required",
    );
    expect(trip).toBeTruthy();
  });

  it("trips required on ACs (>= 20)", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.breakdown.acs.count).toBeGreaterThanOrEqual(20);
    const trip = result.trips.find(
      (t) => t.dimension === "acs" && t.level === "required",
    );
    expect(trip).toBeTruthy();
  });

  it("trips required on complexity multipliers (>= 4 ACs touched)", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.breakdown.multipliers.count).toBeGreaterThanOrEqual(4);
    const trip = result.trips.find(
      (t) => t.dimension === "multipliers" && t.level === "required",
    );
    expect(trip).toBeTruthy();
  });

  it("identifies the specific multiplier keywords in the Dale design", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    const kws = result.breakdown.multipliers.matchedKeywords;
    expect(kws).toContain("idempotency");
    expect(kws).toContain("optimistic-locking");
    expect(kws).toContain("append-only-ledger");
    expect(kws).toContain("multi-tenant");
  });

  it("rationale names the required-tier trips for the operator", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.rationale).toMatch(/REQUIRED-threshold trips/);
    expect(result.rationale).toMatch(/decompose/);
  });

  it("samples model names (audit-visible evidence)", () => {
    const result = sizeDesignDoc(daleDoc, {}, FIXED_NOW);
    expect(result.breakdown.models.samples).toEqual(
      expect.arrayContaining([
        "MobileInventoryLocationType",
        "MobileInventoryLocation",
        "InventoryItem",
        "LocationInventory",
        "InventoryTransaction",
      ]),
    );
  });
});

describe("sizeDesignDoc — threshold overrides", () => {
  it("respects per-dimension threshold overrides", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "test",
      reusePlan: "test",
      proposedApproach: "test",
      acceptanceCriteria: ["AC 1", "AC 2", "AC 3", "AC 4", "AC 5"],
    };
    // Default thresholds: ACs recommend 12, required 20 → 5 ACs = ok.
    // Override: ACs recommend 4, required 10 → 5 ACs = recommended.
    const result = sizeDesignDoc(
      doc,
      { acs: { recommend: 4, required: 10 } },
      FIXED_NOW,
    );
    expect(result.decision).toBe("decompose-recommended");
    expect(result.thresholds.acs).toEqual({ recommend: 4, required: 10 });
    // Other dimensions still use defaults.
    expect(result.thresholds.models).toEqual(DEFAULT_SIZE_THRESHOLDS.models);
  });

  it("partial overrides merge per-dimension fields", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "test",
      reusePlan: "test",
      proposedApproach: "test",
      acceptanceCriteria: ["AC 1"],
    };
    const result = sizeDesignDoc(
      doc,
      // Note: only `recommend` overridden; `required` keeps default.
      { acs: { recommend: 1 } as { recommend: number; required: number } },
      FIXED_NOW,
    );
    expect(result.thresholds.acs.recommend).toBe(1);
    expect(result.thresholds.acs.required).toBe(DEFAULT_SIZE_THRESHOLDS.acs.required);
  });
});

describe("sizeDesignDoc — heuristic edge cases", () => {
  it("stoplist filters out framework PascalCase identifiers", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "Wrap NextResponse and PrismaClient in a helper.",
      dataModel: "Uses ReactNode and JsonValue types throughout.",
      reusePlan: "",
      proposedApproach: "",
      acceptanceCriteria: [],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.breakdown.models.count).toBe(0);
    expect(result.breakdown.models.samples).not.toContain("NextResponse");
    expect(result.breakdown.models.samples).not.toContain("PrismaClient");
  });

  it("dedupes models mentioned multiple times across fields", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "Refactor TruckRouteOptimization.",
      dataModel: "TruckRouteOptimization is the key entity.",
      reusePlan: "Existing TruckRouteOptimization stays.",
      proposedApproach: "TruckRouteOptimization gains a new field.",
      acceptanceCriteria: [],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.breakdown.models.count).toBe(1);
  });

  it("counts HTTP-verb-prefixed endpoint mentions", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "",
      reusePlan: "",
      proposedApproach:
        "Expose GET /api/trucks, POST /api/trucks/:id/parts, DELETE /api/trucks/:id, and PATCH /api/trucks/:id/status.",
      acceptanceCriteria: [],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.breakdown.endpoints.count).toBe(4);
  });

  it("does NOT count UI routes as endpoints", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "",
      reusePlan: "",
      proposedApproach:
        "New route `/my-inventory` and a UI page at `/dispatch`. API endpoint is GET /api/inventory.",
      acceptanceCriteria: [],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    expect(result.breakdown.endpoints.count).toBe(1);
    expect(result.breakdown.routes.count).toBeGreaterThanOrEqual(2);
  });

  it("does not double-count an AC that touches multiple multiplier keywords", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "test",
      reusePlan: "test",
      proposedApproach: "test",
      acceptanceCriteria: [
        "Usage POST is idempotent with optimistic locking and appends to the ledger under multi-tenant isolation.",
      ],
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    // One AC, multiple keywords — count is 1 (count of ACs touched), not 4.
    expect(result.breakdown.multipliers.count).toBe(1);
    expect(result.breakdown.multipliers.matchedKeywords.length).toBeGreaterThanOrEqual(4);
  });

  it("picks the highest tier when both required and recommend trip", () => {
    const doc: BuildDesignDoc = {
      problemStatement: "",
      // Five two-hump PascalCase identifiers — meets the model regex's
      // requirement of at least two camel humps per name (Alpha would NOT
      // match; AlphaModel does).
      dataModel:
        "AlphaModel, BetaModel, GammaModel, DeltaModel, EpsilonModel.",
      reusePlan: "",
      proposedApproach: "",
      // 13 ACs hits acs recommend (>=12) but not required (<20)
      acceptanceCriteria: Array.from({ length: 13 }, (_, i) => `AC ${i + 1}`),
    };
    const result = sizeDesignDoc(doc, {}, FIXED_NOW);
    // Models tripping required dominates ACs tripping only recommend.
    expect(result.breakdown.models.count).toBe(5);
    expect(result.decision).toBe("decompose-required");
  });
});
