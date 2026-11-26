import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  GovernedRequesterReadError,
  isGovernedRequester,
  type GovernedRequesterReader,
} from "./s5-rehearsal-enrollment.server";

function reader(findUnique: (args: unknown) => Promise<unknown>): GovernedRequesterReader {
  return { s5RehearsalRequesterEnrollment: { findUnique } } as unknown as GovernedRequesterReader;
}

describe("isGovernedRequester (BI-9F7192F9 phase 1, single durable marker)", () => {
  it("is one unique-index read keyed by userId, selecting only the id", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-1" }));
    await expect(isGovernedRequester("user-1", reader(findUnique))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { id: true } });
  });

  it("is true for a retired requester too: the marker outlives retirement", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-retired" }));
    await expect(isGovernedRequester("user-retired", reader(findUnique))).resolves.toBe(true);
  });

  it("is false only when the read succeeds and finds no row", async () => {
    await expect(isGovernedRequester("user-2", reader(async () => null))).resolves.toBe(false);
  });

  it("reports a read error as an error, never as 'not governed' (fails closed)", async () => {
    const cause = new Error("connection reset");
    const failing = reader(async () => {
      throw cause;
    });
    const error = await isGovernedRequester("user-3", failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernedRequesterReadError);
    expect((error as GovernedRequesterReadError).cause).toBe(cause);
  });

  it("refuses an empty or non-string userId without reading", async () => {
    const findUnique = vi.fn(async () => null);
    for (const bad of ["", "   ", undefined as unknown as string]) {
      await expect(isGovernedRequester(bad, reader(findUnique))).rejects.toBeInstanceOf(GovernedRequesterReadError);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});
