import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u1", platformRole: "admin", isSuperuser: true },
  }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    workLocation: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@dpf/db";

import { setWorkLocationJurisdiction } from "./reference-data-admin";

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.workLocation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "loc-1",
    name: "Headquarters",
  });
});

describe("setWorkLocationJurisdiction — the write path BI-9252B9EA shipped without", () => {
  it("sets a jurisdiction from the closed vocabulary", async () => {
    const result = await setWorkLocationJurisdiction("loc-1", "us");

    expect(result.ok).toBe(true);
    expect(prisma.workLocation.update).toHaveBeenCalledWith({
      where: { id: "loc-1" },
      data: { jurisdictionSlug: "us" },
    });
    expect(result.message).toContain("us");
  });

  it("accepts every slug the resolver recognises", async () => {
    for (const slug of ["global", "us", "eu", "uk"]) {
      const result = await setWorkLocationJurisdiction("loc-1", slug);
      expect(result.ok, `${slug} should be accepted`).toBe(true);
    }
  });

  it("refuses a value outside the vocabulary rather than storing it", async () => {
    // An unrecognised slug reaching the policy spine is the one case the
    // resolver cannot answer safely, so it is rejected at the write.
    const result = await setWorkLocationJurisdiction("loc-1", "canada");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("canada");
    expect(prisma.workLocation.update).not.toHaveBeenCalled();
  });

  it("allows clearing, and says plainly what that costs", async () => {
    const result = await setWorkLocationJurisdiction("loc-1", null);

    expect(result.ok).toBe(true);
    expect(prisma.workLocation.update).toHaveBeenCalledWith({
      where: { id: "loc-1" },
      data: { jurisdictionSlug: null },
    });
    // Clearing it stops every worker at that location being actioned. An
    // operator must not discover that by watching nothing happen.
    expect(result.message).toMatch(/will not be actioned|no longer/i);
  });

  it("treats blank input as clearing rather than as a slug", async () => {
    const result = await setWorkLocationJurisdiction("loc-1", "   ");

    expect(result.ok).toBe(true);
    expect(prisma.workLocation.update).toHaveBeenCalledWith({
      where: { id: "loc-1" },
      data: { jurisdictionSlug: null },
    });
  });

  it("refuses an unknown location", async () => {
    (prisma.workLocation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await setWorkLocationJurisdiction("nope", "us");

    expect(result.ok).toBe(false);
    expect(prisma.workLocation.update).not.toHaveBeenCalled();
  });
});
