// BI-7E49FA15 — isJobEnabled is the single implementation of the per-job
// kill switch, and its read-failure posture is a stated decision: fail OPEN.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { scheduledJob: { findUnique: vi.fn() } },
}));

import { prisma } from "@dpf/db";
import { isJobEnabled } from "./core";

const findUnique = vi.mocked(prisma.scheduledJob.findUnique);

beforeEach(() => {
  findUnique.mockReset();
});

describe("isJobEnabled", () => {
  it("returns false only when the operator set enabled=false", async () => {
    findUnique.mockResolvedValue({ enabled: false } as never);
    expect(await isJobEnabled("code-graph-reconcile")).toBe(false);
    expect(findUnique).toHaveBeenCalledWith({
      where: { jobId: "code-graph-reconcile" },
      select: { enabled: true },
    });
  });

  it("returns true for an enabled row", async () => {
    findUnique.mockResolvedValue({ enabled: true } as never);
    expect(await isJobEnabled("code-graph-reconcile")).toBe(true);
  });

  it("defaults to enabled when no row exists (never toggled)", async () => {
    findUnique.mockResolvedValue(null as never);
    expect(await isJobEnabled("code-graph-reconcile")).toBe(true);
  });

  it("fails OPEN: a read failure reports enabled rather than taking the schedule down", async () => {
    findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(isJobEnabled("code-graph-reconcile")).resolves.toBe(true);
  });
});
