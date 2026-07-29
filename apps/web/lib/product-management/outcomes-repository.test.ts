import { describe, expect, it, vi } from "vitest";
import {
  ProductOutcomeConflictError,
  ProductOutcomeNotFoundError,
  ProductOutcomeValidationError,
  createProductObjective,
  linkObjectiveWork,
  recordProductOutcomeObservation,
  transitionProductObjective,
} from "./outcomes-repository";

function objective(overrides: Record<string, unknown> = {}) {
  return {
    id: "objective-row-1",
    objectiveId: "OBJ-ONE",
    organizationId: "org-1",
    productId: "product-1",
    status: "draft",
    measureKind: "percentage",
    measureUnit: "%",
    baselineValue: 40,
    targetValue: 60,
    baselineNarrative: null,
    targetNarrative: null,
    reviewAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createProductObjective", () => {
  it("fails closed when the product is outside the authorized organization", async () => {
    const db = {
      product: { findFirst: vi.fn(async () => null) },
      principal: { findFirst: vi.fn() },
      productObjective: { create: vi.fn() },
    };

    await expect(
      createProductObjective(db as never, {
        organizationId: "org-1",
        productId: "product-other-org",
        title: "Improve repeat bookings",
        problemStatement: "Clients do not rebook consistently.",
        outcomeHypothesis: "A clearer follow-up will increase repeat bookings.",
        ownerPrincipalId: null,
        measureKind: "percentage",
        measureDefinition: "Share of completed visits rebooked within 30 days",
        measureUnit: "%",
        baselineValue: 40,
        targetValue: 60,
        baselineNarrative: null,
        targetNarrative: null,
        reviewCadence: "monthly",
        reviewAt: new Date("2026-08-31T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeNotFoundError);
    expect(db.productObjective.create).not.toHaveBeenCalled();
  });

  it("creates only against an organization-scoped business Product", async () => {
    const db = {
      product: {
        findFirst: vi.fn(async () => ({
          id: "product-1",
          organizationId: "org-1",
        })),
      },
      principal: { findFirst: vi.fn() },
      productObjective: {
        create: vi.fn(async ({ data }) => ({
          ...objective(),
          ...data,
        })),
      },
    };

    const created = await createProductObjective(db as never, {
      organizationId: "org-1",
      productId: "product-1",
      title: "Improve repeat bookings",
      problemStatement: "Clients do not rebook consistently.",
      outcomeHypothesis: "A clearer follow-up will increase repeat bookings.",
      ownerPrincipalId: null,
      measureKind: "percentage",
      measureDefinition: "Share of completed visits rebooked within 30 days",
      measureUnit: "%",
      baselineValue: 40,
      targetValue: 60,
      baselineNarrative: null,
      targetNarrative: null,
      reviewCadence: "monthly",
      reviewAt: new Date("2026-08-31T00:00:00.000Z"),
    });

    expect(created.productId).toBe("product-1");
    expect(db.productObjective.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        productId: "product-1",
        status: "draft",
      }),
    });
  });

  it("rejects a non-canonical review cadence at the repository boundary", async () => {
    const db = {
      product: {
        findFirst: vi.fn(async () => ({
          id: "product-1",
          organizationId: "org-1",
        })),
      },
      principal: { findFirst: vi.fn() },
      productObjective: { create: vi.fn() },
    };

    await expect(
      createProductObjective(db as never, {
        organizationId: "org-1",
        productId: "product-1",
        title: "Improve repeat bookings",
        problemStatement: null,
        outcomeHypothesis: "Follow-up will increase repeat bookings.",
        ownerPrincipalId: null,
        measureKind: "percentage",
        measureDefinition: "Completed visits rebooked within 30 days",
        measureUnit: "%",
        baselineValue: 40,
        targetValue: 60,
        baselineNarrative: null,
        targetNarrative: null,
        reviewCadence: "fortnightly" as never,
        reviewAt: new Date("2026-08-31T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeValidationError);
    expect(db.productObjective.create).not.toHaveBeenCalled();
  });
});

describe("transitionProductObjective", () => {
  it("rejects reopening a closed objective", async () => {
    const db = {
      productObjective: {
        findFirst: vi.fn(async () => objective({ status: "closed" })),
        update: vi.fn(),
      },
    };
    await expect(
      transitionProductObjective(db as never, {
        organizationId: "org-1",
        objectiveId: "OBJ-ONE",
        to: "active",
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeConflictError);
    expect(db.productObjective.update).not.toHaveBeenCalled();
  });
});

describe("linkObjectiveWork", () => {
  it("requires contributing backlog to share the objective's business Product", async () => {
    const db = {
      productObjective: {
        findFirst: vi.fn(async () => objective({ status: "active" })),
      },
      backlogItem: {
        findFirst: vi.fn(async () => ({
          id: "backlog-row-1",
          itemId: "BI-OTHER",
          organizationId: "org-1",
          businessProductId: "product-2",
        })),
      },
      productObjectiveWork: { upsert: vi.fn() },
    };

    await expect(
      linkObjectiveWork(db as never, {
        organizationId: "org-1",
        objectiveId: "OBJ-ONE",
        backlogItemId: "BI-OTHER",
        contributionKind: "delivery",
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeConflictError);
    expect(db.productObjectiveWork.upsert).not.toHaveBeenCalled();
  });
});

describe("recordProductOutcomeObservation", () => {
  it("appends a correction and supersedes the prior observation in one transaction", async () => {
    const prior = {
      id: "observation-row-1",
      observationId: "OBS-ONE",
      objectiveId: "objective-row-1",
      supersededBy: null,
    };
    const tx = {
      productObjective: {
        findFirst: vi.fn(async () => objective({ status: "active" })),
      },
      productOutcomeObservation: {
        findFirst: vi.fn(async () => prior),
        create: vi.fn(async ({ data }) => ({
          id: "observation-row-2",
          observationId: "OBS-TWO",
          ...data,
        })),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await recordProductOutcomeObservation(db as never, {
      organizationId: "org-1",
      objectiveId: "OBJ-ONE",
      observedAt: new Date("2026-07-28T00:00:00.000Z"),
      numericValue: 52,
      narrative: "Corrected after the booking export was reconciled.",
      sourceKind: "booking",
      sourceRef: "booking-export:2026-07",
      confidence: 0.9,
      provenance: { report: "monthly-booking-export" },
      recordedByPrincipalId: null,
      supersedesObservationId: "OBS-ONE",
    });

    expect(result.supersedesObservationId).toBe("observation-row-1");
    expect(tx.productOutcomeObservation.create).toHaveBeenCalledOnce();
  });

  it("does not permit a second correction of an already-superseded observation", async () => {
    const tx = {
      productObjective: {
        findFirst: vi.fn(async () => objective({ status: "active" })),
      },
      productOutcomeObservation: {
        findFirst: vi.fn(async () => ({
          id: "observation-row-1",
          observationId: "OBS-ONE",
          objectiveId: "objective-row-1",
          supersededBy: { id: "observation-row-2" },
        })),
        create: vi.fn(),
      },
    };
    const db = { $transaction: vi.fn(async (callback) => callback(tx)) };

    await expect(
      recordProductOutcomeObservation(db as never, {
        organizationId: "org-1",
        objectiveId: "OBJ-ONE",
        observedAt: new Date("2026-07-28T00:00:00.000Z"),
        numericValue: 52,
        narrative: null,
        sourceKind: "booking",
        sourceRef: null,
        confidence: null,
        provenance: null,
        recordedByPrincipalId: null,
        supersedesObservationId: "OBS-ONE",
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeConflictError);
    expect(tx.productOutcomeObservation.create).not.toHaveBeenCalled();
  });

  it("rejects an impossible percentage observation before persistence", async () => {
    const tx = {
      productObjective: {
        findFirst: vi.fn(async () => objective({ status: "active" })),
      },
      productOutcomeObservation: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    const db = { $transaction: vi.fn(async (callback) => callback(tx)) };

    await expect(
      recordProductOutcomeObservation(db as never, {
        organizationId: "org-1",
        objectiveId: "OBJ-ONE",
        observedAt: new Date("2026-07-28T00:00:00.000Z"),
        numericValue: 101,
        narrative: null,
        sourceKind: "booking",
        sourceRef: null,
        confidence: null,
        provenance: null,
        recordedByPrincipalId: null,
        supersedesObservationId: null,
      }),
    ).rejects.toBeInstanceOf(ProductOutcomeValidationError);
    expect(tx.productOutcomeObservation.create).not.toHaveBeenCalled();
  });
});
