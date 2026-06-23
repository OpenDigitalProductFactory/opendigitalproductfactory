import { describe, it, expect, vi } from "vitest";
import { importRoster, type RosterImportClient } from "./roster-import-actions";
import type { ProposedEmployee } from "./roster-import";

function emp(p: Partial<ProposedEmployee>): ProposedEmployee {
  return {
    firstName: "A",
    lastName: "B",
    displayName: "A B",
    workEmail: null,
    phoneWork: null,
    title: null,
    department: null,
    startDate: null,
    sourceRow: 0,
    issues: [],
    duplicateInFile: false,
    ...p,
  };
}

describe("importRoster", () => {
  it("creates new employees and skips ones whose work email already exists", async () => {
    const create = vi.fn(async (_a: unknown) => ({ id: "x" }));
    const db: RosterImportClient = {
      employeeProfile: {
        findMany: vi.fn(async (_a: unknown) => [{ workEmail: "existing@x.io" }]),
        create,
      },
    };
    const res = await importRoster(
      [
        emp({ displayName: "New One", workEmail: "new@x.io" }),
        emp({ displayName: "Old One", workEmail: "EXISTING@x.io" }), // dup of existing (case-insensitive)
      ],
      db,
    );
    expect(res).toMatchObject({ created: 1, skippedExisting: 1, failed: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ displayName: "New One", workEmail: "new@x.io", status: "onboarding" });
  });

  it("fails soft per row — one bad create does not abort the batch", async () => {
    const create = vi.fn(async (a: unknown) => {
      if ((a as { data: { displayName: string } }).data.displayName === "Boom") throw new Error("db down");
      return { id: "x" };
    });
    const db: RosterImportClient = {
      employeeProfile: { findMany: vi.fn(async (_a: unknown) => []), create },
    };
    const res = await importRoster(
      [
        emp({ displayName: "Good", workEmail: "g@x.io", sourceRow: 0 }),
        emp({ displayName: "Boom", workEmail: "b@x.io", sourceRow: 1 }),
      ],
      db,
    );
    expect(res).toMatchObject({ created: 1, failed: 1 });
    expect(res.errors[0]).toContain("row 1");
  });

  it("guards intra-batch duplicate emails", async () => {
    const create = vi.fn(async (_a: unknown) => ({ id: "x" }));
    const db: RosterImportClient = {
      employeeProfile: { findMany: vi.fn(async (_a: unknown) => []), create },
    };
    const res = await importRoster(
      [
        emp({ displayName: "One", workEmail: "same@x.io" }),
        emp({ displayName: "Two", workEmail: "same@x.io" }),
      ],
      db,
    );
    expect(res).toMatchObject({ created: 1, skippedExisting: 1 });
  });

  it("creates name-only employees (no email) without a dedup lookup", async () => {
    const findMany = vi.fn(async (_a: unknown) => []);
    const create = vi.fn(async (_a: unknown) => ({ id: "x" }));
    const db: RosterImportClient = { employeeProfile: { findMany, create } };
    const res = await importRoster([emp({ displayName: "Cher", firstName: "Cher", lastName: "" })], db);
    expect(res.created).toBe(1);
    expect(findMany).not.toHaveBeenCalled(); // no emails → no lookup
    const arg = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ firstName: "Cher", displayName: "Cher" });
    expect(arg.data).not.toHaveProperty("workEmail");
  });
});
