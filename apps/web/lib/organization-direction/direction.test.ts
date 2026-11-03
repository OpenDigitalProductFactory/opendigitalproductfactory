import { describe, expect, it, vi } from "vitest";
import {
  MAX_INSTANCE_OUTCOMES,
  directionGaps,
  loadOrganizationDirection,
  newInstanceOutcomeId,
  sanitizeDirectionInput,
  saveOrganizationDirection,
  type DirectionWriteClient,
} from "./direction";

describe("sanitizeDirectionInput", () => {
  it("trims fields and drops fully blank outcome rows", () => {
    const result = sanitizeDirectionInput({
      mission: "  Help families breathe easier.  ",
      vision: " Every home has clean air. ",
      outcomes: [
        { statement: " Fewer asthma visits ", measure: " ER visits drop " },
        { statement: "   ", measure: "" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        mission: "Help families breathe easier.",
        vision: "Every home has clean air.",
        outcomes: [{ id: null, statement: "Fewer asthma visits", measure: "ER visits drop" }],
      },
    });
  });

  it("refuses a measure with no statement", () => {
    const result = sanitizeDirectionInput({ mission: "", vision: "", outcomes: [{ statement: "", measure: "x" }] });
    expect(result.ok).toBe(false);
  });

  it(`refuses more than ${MAX_INSTANCE_OUTCOMES} outcomes`, () => {
    const outcomes = Array.from({ length: MAX_INSTANCE_OUTCOMES + 1 }, (_, i) => ({ statement: `Outcome ${i}` }));
    const result = sanitizeDirectionInput({ mission: "", vision: "", outcomes });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/five/i);
  });

  it("refuses an over-long mission", () => {
    expect(sanitizeDirectionInput({ mission: "x".repeat(2000), vision: "", outcomes: [] }).ok).toBe(false);
  });

  it("refuses a non-object payload", () => {
    expect(sanitizeDirectionInput(null).ok).toBe(false);
  });
});

describe("directionGaps", () => {
  it("names each missing part", () => {
    expect(directionGaps({ mission: null, vision: " ", outcomeCount: 0 })).toEqual(["mission", "vision", "outcomes"]);
    expect(directionGaps({ mission: "m", vision: "v", outcomeCount: 1 })).toEqual([]);
  });
});

function fakeDb(existing: Array<{ id: string; statement: string; measure: string | null; ordinal: number }>, lastVersion: number | null) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => (args: unknown) => {
    (calls[name] ??= []).push(args);
    if (name === "instanceOutcome.create") return Promise.resolve({ id: (args as { data: { id: string } }).data.id });
    return Promise.resolve({});
  };
  const tx = {
    businessContext: { upsert: vi.fn(record("businessContext.upsert")) },
    instanceOutcome: {
      findMany: vi.fn(() => Promise.resolve(existing)),
      updateMany: vi.fn(record("instanceOutcome.updateMany")),
      update: vi.fn(record("instanceOutcome.update")),
      create: vi.fn(record("instanceOutcome.create")),
    },
    instanceDirectionRevision: {
      findFirst: vi.fn(() => Promise.resolve(lastVersion === null ? null : { version: lastVersion })),
      create: vi.fn(record("instanceDirectionRevision.create")),
    },
  };
  const db = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as DirectionWriteClient;
  return { db, calls };
}

describe("saveOrganizationDirection", () => {
  it("updates kept outcomes, retires removed ones, creates new ones and appends the next revision", async () => {
    const { db, calls } = fakeDb(
      [
        { id: "keep", statement: "Old", measure: null, ordinal: 0 },
        { id: "gone", statement: "Drop me", measure: null, ordinal: 1 },
      ],
      2,
    );
    const result = await saveOrganizationDirection(db, {
      organizationId: "org-1",
      changedByUserId: "user-1",
      source: "settings",
      direction: {
        mission: "M",
        vision: "V",
        outcomes: [
          { id: "keep", statement: "Kept", measure: "Measure" },
          { id: null, statement: "Brand new", measure: null },
        ],
      },
      now: new Date("2026-10-28T00:00:00Z"),
      mintId: () => "IO-TEST0001",
    });

    expect(result.version).toBe(3);
    expect(calls["businessContext.upsert"]?.[0]).toMatchObject({
      where: { organizationId: "org-1" },
      update: { mission: "M", vision: "V" },
    });
    expect(calls["instanceOutcome.updateMany"]?.[0]).toMatchObject({
      where: { organizationId: "org-1", id: { in: ["gone"] }, lifecycle: "active" },
      data: { lifecycle: "retired", lifecycleAt: new Date("2026-10-28T00:00:00Z") },
    });
    expect(calls["instanceOutcome.update"]?.[0]).toMatchObject({
      where: { id: "keep" },
      data: { statement: "Kept", measure: "Measure", ordinal: 0 },
    });
    expect(calls["instanceOutcome.create"]?.[0]).toMatchObject({
      data: { id: "IO-TEST0001", organizationId: "org-1", statement: "Brand new", ordinal: 1, lifecycle: "active" },
    });
    expect(calls["instanceDirectionRevision.create"]?.[0]).toMatchObject({
      data: {
        organizationId: "org-1",
        version: 3,
        mission: "M",
        vision: "V",
        changedByUserId: "user-1",
        source: "settings",
        outcomes: [
          { id: "keep", statement: "Kept", measure: "Measure" },
          { id: "IO-TEST0001", statement: "Brand new", measure: null },
        ],
      },
    });
  });

  it("treats an id that is not an active outcome of this organization as new", async () => {
    const { db, calls } = fakeDb([], null);
    const result = await saveOrganizationDirection(db, {
      organizationId: "org-1",
      changedByUserId: null,
      source: "setup",
      direction: { mission: "", vision: "", outcomes: [{ id: "foreign", statement: "S", measure: null }] },
    });
    expect(result.version).toBe(1);
    expect(calls["instanceOutcome.update"]).toBeUndefined();
    expect(calls["instanceOutcome.create"]).toHaveLength(1);
    expect(calls["businessContext.upsert"]?.[0]).toMatchObject({ update: { mission: null, vision: null } });
  });
});

describe("loadOrganizationDirection", () => {
  it("returns empty fields, never invented ones, when nothing is recorded", async () => {
    const db = {
      businessContext: { findUnique: vi.fn(() => Promise.resolve(null)) },
      instanceOutcome: { findMany: vi.fn(() => Promise.resolve([])) },
      instanceDirectionRevision: { findFirst: vi.fn(() => Promise.resolve(null)) },
    };
    expect(await loadOrganizationDirection(db, "org-1")).toEqual({
      mission: null,
      vision: null,
      outcomes: [],
      version: null,
    });
  });
});

describe("newInstanceOutcomeId", () => {
  it("mints the semantic IO-XXXXXXXX id the epic link points at", () => {
    expect(newInstanceOutcomeId()).toMatch(/^IO-[0-9A-F]{8}$/);
    expect(newInstanceOutcomeId()).not.toBe(newInstanceOutcomeId());
  });
});
