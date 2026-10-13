import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), revalidate: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: { JsonNull: "JSON_NULL" }, prisma: {
  workroom: { findUnique: mocks.find, update: mocks.update, updateMany: mocks.updateMany },
} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { platformRole: "admin" } }) }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
import { saveWorkroomBoundary } from "./workroom-boundary";

const original = [{ workroomBoundary: { sensitivityCeiling: "engineering-only", purpose: "Before review" } }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue({ id: "row", updatedAt: new Date("2026-10-11T00:00:00Z"), scopeClaims: original });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

it("refuses an ordinary edit that races an approved classification correction", async () => {
  mocks.updateMany.mockResolvedValue({ count: 0 });
  const result = await saveWorkroomBoundary("work-capsule:WC-TEST", "row", {
    purpose: "New purpose", sensitivityCeiling: null, preserveSensitivity: true,
  });
  expect(result.ok).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("conditions an intent edit on its exact original declaration and timestamp", async () => {
  const result = await saveWorkroomBoundary("work-capsule:WC-TEST", "row", {
    purpose: "New purpose", sensitivityCeiling: null, preserveSensitivity: true,
  });
  expect(result.ok).toBe(true);
  expect(mocks.updateMany.mock.calls[0][0].where).toEqual({
    id: "row", updatedAt: new Date("2026-10-11T00:00:00Z"), scopeClaims: { equals: original },
  });
});
