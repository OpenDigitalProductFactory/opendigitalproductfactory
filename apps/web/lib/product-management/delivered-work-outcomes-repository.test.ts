import { describe, expect, it } from "vitest";

import {
  designatePlatformWorkProduct,
  recordDeliveredWorkOutcome,
} from "./delivered-work-outcomes-repository";
import { ProductOutcomeConflictError, ProductOutcomeNotFoundError } from "./outcomes-repository";

const observedAt = new Date("2026-10-28T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(observedAt.getTime() - daysAgo * day);

type Row = Record<string, unknown>;
type Item = {
  id: string; itemId: string; status: string; scopeKind: string | null; businessProductId: string | null;
  organizationId: string | null; epicId: string | null; completedAt: Date | null;
};
type Activity = { id: string; backlogItemId: string; kind: string; recordedAt: Date; payload: Row };

function between(value: Date, range: { gte?: Date; lte?: Date } | undefined) {
  if (!range) return true;
  return (!range.gte || value >= range.gte) && (!range.lte || value <= range.lte);
}

function pathEquals(payload: Row, filter: { path: string[]; equals: unknown } | undefined) {
  return !filter || payload[filter.path[0]!] === filter.equals;
}

/** An in-memory store that understands exactly the queries the repository issues. */
function store(seed: { items: Item[]; activities?: Activity[]; objectives?: Row[]; products?: Row[]; epics?: Row[] }) {
  const items = seed.items;
  const activities = seed.activities ?? [];
  const objectives: Row[] = seed.objectives ?? [];
  const observations: Row[] = [];
  const products = seed.products ?? [{ id: "product-1", organizationId: "org-1", effectiveTo: null }];
  const epics = seed.epics ?? [{ id: "epic-row-1", epicId: "EP-ONE", title: "Delivery holds its purpose", description: "Why the epic exists." }];
  let sequence = 0;

  const itemMatches = (item: Item, where: Row | undefined): boolean => {
    if (!where) return true;
    if ("epicId" in where && item.epicId !== where.epicId) return false;
    if ("businessProductId" in where && item.businessProductId !== where.businessProductId) return false;
    if (Array.isArray(where.OR)) {
      return (where.OR as Row[]).some((clause) => "scopeKind" in clause && (clause.scopeKind === null
        ? item.scopeKind === null
        : ((clause.scopeKind as { in: string[] }).in).includes(item.scopeKind ?? "")));
    }
    return true;
  };

  const db = {
    backlogItem: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const item = items.find((entry) => entry.id === where.id);
        if (!item) return null;
        const epic = epics.find((entry) => entry.id === item.epicId) ?? null;
        return { ...item, epic };
      },
      findFirst: async () => null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        items.filter((item) => where.id.in.includes(item.id)).map(({ id, itemId, status }) => ({ id, itemId, status })),
    },
    backlogItemActivity: {
      findMany: async ({ where }: { where: Row }) => activities.filter((row) => {
        if (where.kind && row.kind !== where.kind) return false;
        if (where.backlogItemId && !(where.backlogItemId as { in: string[] }).in.includes(row.backlogItemId)) return false;
        if (!between(row.recordedAt, where.recordedAt as { gte?: Date; lte?: Date })) return false;
        if (!pathEquals(row.payload, where.payload as { path: string[]; equals: unknown })) return false;
        if (where.backlogItem) {
          const item = items.find((entry) => entry.id === row.backlogItemId);
          if (!item || !itemMatches(item, where.backlogItem as Row)) return false;
        }
        if (Array.isArray(where.OR)) {
          return (where.OR as Row[]).some((clause) => clause.kind === row.kind
            && pathEquals(row.payload, clause.payload as { path: string[]; equals: unknown }));
        }
        return true;
      }).sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime()),
    },
    product: {
      findFirst: async ({ where }: { where: Row }) =>
        products.find((entry) => entry.id === where.id && entry.organizationId === where.organizationId && entry.effectiveTo === null) ?? null,
    },
    principal: { findFirst: async () => null },
    productObjective: {
      findFirst: async ({ where }: { where: Row }) => objectives.find((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      findMany: async ({ where }: { where: Row }) => objectives.filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value)),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `objective-row-${++sequence}`, ...data };
        objectives.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = objectives.find((entry) => entry.id === where.id)!;
        for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
        return row;
      },
    },
    productObjectiveWork: { upsert: async () => { throw new Error("delivery must not link work"); } },
    productOutcomeObservation: {
      findFirst: async ({ where }: { where: Row }) => observations.find((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      count: async () => observations.length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `observation-row-${++sequence}`, ...data };
        observations.push(row);
        return row;
      },
    },
  };
  return { db, objectives, observations };
}

const standing = {
  id: "standing-row", objectiveId: "OBJ-STANDING", organizationId: "org-1", productId: "product-1",
  status: "active", measureKind: "percentage", measureUnit: null, baselineValue: null, targetValue: 100,
  baselineNarrative: null, targetNarrative: null, reviewAt: null,
  sourceKind: "platform-work", sourceRef: "product-1",
};

function platformItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id, itemId: `BI-${id.toUpperCase()}`, status: "done", scopeKind: "platform", businessProductId: null,
    organizationId: null, epicId: "epic-row-1", completedAt: at(0), ...overrides,
  };
}

function deliveredAt(itemRowId: string, daysAgo: number, id = `act-${itemRowId}-${daysAgo}`): Activity {
  return { id, backlogItemId: itemRowId, kind: "status_change", recordedAt: at(daysAgo), payload: { from: "in-progress", to: "done" } };
}

describe("recordDeliveredWorkOutcome", () => {
  it("records the epic's matured hold rate once per delivery, creating the epic objective on first use", async () => {
    const fake = store({
      objectives: [{ ...standing }],
      items: [
        platformItem("now"),
        platformItem("a"),
        platformItem("b"),
        platformItem("c", { status: "open" }),
      ],
      activities: [
        deliveredAt("a", 40), deliveredAt("b", 30), deliveredAt("c", 20),
        { id: "reopen-c", backlogItemId: "c", kind: "status_change", recordedAt: at(10), payload: { from: "done", to: "open" } },
      ],
    });

    const first = await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt });
    const second = await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt });

    expect(first).toMatchObject({ recorded: true, objectiveCreated: true, value: 66.666667 });
    expect(second).toEqual({ recorded: false, reason: "already-recorded" });
    const epicObjective = fake.objectives.find((row) => row.sourceKind === "epic");
    expect(epicObjective).toMatchObject({
      sourceRef: "EP-ONE", status: "active", productId: "product-1", organizationId: "org-1",
      measureKind: "percentage", targetValue: 100,
    });
    expect(fake.observations).toHaveLength(1);
    expect(fake.observations[0]).toMatchObject({
      objectiveId: epicObjective!.id,
      sourceKind: "delivery",
      sourceRef: `BI-NOW@${at(0).toISOString()}`,
      numericValue: 66.666667,
      recordedByPrincipalId: null,
      provenance: expect.objectContaining({
        method: "delivered-work-hold-rate.v1",
        deliveredItemId: "BI-NOW",
        numerator: 2,
        denominator: 3,
        notHeld: [{ itemId: "BI-C", reason: "reopened" }],
      }),
    });
  });

  it("records work with no epic on the standing platform-work objective", async () => {
    const fake = store({
      objectives: [{ ...standing }],
      items: [platformItem("now", { epicId: null }), platformItem("a", { epicId: null }), platformItem("x")],
      activities: [deliveredAt("a", 30), deliveredAt("x", 30)],
    });

    const result = await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt });

    expect(result).toMatchObject({ recorded: true, objectiveId: "OBJ-STANDING", objectiveCreated: false, value: 100 });
    expect(fake.observations[0]).toMatchObject({ provenance: expect.objectContaining({ denominator: 1 }) });
  });

  it("records nothing, and says why, when no business Product is designated for platform work", async () => {
    const fake = store({ items: [platformItem("now")], activities: [deliveredAt("now", 30)] });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "no-platform-work-product" });
    expect(fake.objectives).toHaveLength(0);
  });

  it("leaves archetype and business-Product work to their own objectives", async () => {
    const fake = store({
      objectives: [{ ...standing }],
      items: [platformItem("now", { scopeKind: "archetype-leaf" })],
    });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "out-of-scope" });
  });

  it("records nothing for an item that is not done", async () => {
    const fake = store({ objectives: [{ ...standing }], items: [platformItem("now", { status: "in-progress" })] });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "not-delivered" });
  });

  it("does not invent a rate before any delivery has matured", async () => {
    const fake = store({
      objectives: [{ ...standing }],
      items: [platformItem("now"), platformItem("a")],
      activities: [deliveredAt("a", 3)],
    });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "no-matured-cohort" });
    expect(fake.observations).toHaveLength(0);
  });

  it("respects an epic objective someone closed", async () => {
    const fake = store({
      objectives: [{ ...standing }, { ...standing, id: "closed-row", objectiveId: "OBJ-CLOSED", status: "closed", sourceKind: "epic", sourceRef: "EP-ONE" }],
      items: [platformItem("now"), platformItem("a")],
      activities: [deliveredAt("a", 30)],
    });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "objective-not-active" });
  });

  it("refuses to guess between two organizations' designations for unowned platform work", async () => {
    const fake = store({
      objectives: [{ ...standing }, { ...standing, id: "other", objectiveId: "OBJ-OTHER", organizationId: "org-2", sourceRef: "product-2" }],
      items: [platformItem("now")],
    });

    expect(await recordDeliveredWorkOutcome(fake.db as never, { backlogItemRowId: "now", observedAt }))
      .toEqual({ recorded: false, reason: "platform-work-product-ambiguous" });
  });
});

describe("designatePlatformWorkProduct", () => {
  it("creates and activates the standing objective, and is idempotent for the same Product", async () => {
    const fake = store({ items: [] });

    const first = await designatePlatformWorkProduct(fake.db as never, { organizationId: "org-1", productId: "product-1" });
    const second = await designatePlatformWorkProduct(fake.db as never, { organizationId: "org-1", productId: "product-1" });

    expect(first).toMatchObject({ created: true });
    expect(second).toEqual({ created: false, objectiveId: first.objectiveId });
    expect(fake.objectives).toHaveLength(1);
    expect(fake.objectives[0]).toMatchObject({
      sourceKind: "platform-work", sourceRef: "product-1", status: "active", measureKind: "percentage", targetValue: 100,
    });
  });

  it("refuses a second Product while one is designated", async () => {
    const fake = store({
      objectives: [{ ...standing }],
      items: [],
      products: [{ id: "product-1", organizationId: "org-1", effectiveTo: null }, { id: "product-2", organizationId: "org-1", effectiveTo: null }],
    });

    await expect(designatePlatformWorkProduct(fake.db as never, { organizationId: "org-1", productId: "product-2" }))
      .rejects.toBeInstanceOf(ProductOutcomeConflictError);
  });

  it("refuses a Product outside the organization", async () => {
    const fake = store({ items: [] });

    await expect(designatePlatformWorkProduct(fake.db as never, { organizationId: "org-1", productId: "product-x" }))
      .rejects.toBeInstanceOf(ProductOutcomeNotFoundError);
  });
});
