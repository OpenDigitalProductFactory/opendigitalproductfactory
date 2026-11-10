import { describe, expect, it } from "vitest";
import { isRolledBackPostgresConflict } from "./postgres-transaction-conflict";

describe("database-confirmed transaction rollback", () => {
  it.each(["P2034", "40001", "40P01"])("recognizes the explicit conflict code %s", code => {
    expect(isRolledBackPostgresConflict({ code })).toBe(true);
  });

  it.each(["40001", "40P01"])("recognizes Prisma's raw-query adapter envelope %s", originalCode => {
    expect(isRolledBackPostgresConflict({ code: "P2010", meta: {
      driverAdapterError: { cause: { originalCode, kind: "TransactionWriteConflict" } },
    } })).toBe(true);
  });

  it.each([
    null, undefined, new Error("40001"), { code: "P2002" },
    { code: "P2010", meta: { code: "40001", message: "40001" } },
    ...["23505", "08006", "42883", undefined].map(originalCode => ({
      code: "P2010", meta: { driverAdapterError: { cause: { originalCode } } },
    })),
  ])("rejects unrelated errors and unproven rollback", error => {
    expect(isRolledBackPostgresConflict(error)).toBe(false);
  });
});
