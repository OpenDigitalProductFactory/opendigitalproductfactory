import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), revalidate: vi.fn(), auth: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: { JsonNull: null }, prisma: { workroom: { findUnique: m.read, update: m.write } } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@/lib/work-management/workroom-posture-defaults", () => ({
  clearWorkroomPostureDefault: vi.fn(), getWorkroomPostureDefault: vi.fn(), setWorkroomPostureDefault: vi.fn(),
}));

import { resetWorkroomPosture, saveWorkroomPosture, saveWorkroomShape } from "./workroom-posture";

const oldEpoch = "00000000-0000-4000-8000-000000000001";
const newEpoch = "00000000-0000-4000-8000-000000000002";
const claim = { kind: "path", value: "file.ts", intent: "edit", recordedByPrincipalId: "owner",
  recordedAt: "2026-11-01T10:00:00Z", releaseEpoch: oldEpoch };
const operations = [
  ["posture save", () => saveWorkroomPosture("room-row", "case", { proactivityLevel: "balanced" })],
  ["posture reset", () => resetWorkroomPosture("room-row", "case")],
  ["shape save", () => saveWorkroomShape("room-row", "case", "change-consequential")],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "operator", isSuperuser: true } });
});

describe("posture writers preserve a concurrently acquired scope epoch", () => {
  it.each(operations)("%s preserves protected ownership in a mixed metadata record", async (_name, run) => {
    const row = { id: "room-row", updatedAt: new Date(), scopeClaims: [{ ...claim,
      workroomPosture: { proactivityLevel: "balanced" }, workroomShape: "change-consequential" }] };
    m.read.mockResolvedValue(row);
    m.write.mockImplementation(async ({ data }) => ({ ...row, ...data }));
    await run();
    expect(m.write.mock.calls[0][0].data.scopeClaims).toContainEqual(expect.objectContaining(claim));
  });

  it.each(operations)("%s cannot restore an old ownership snapshot", async (_name, run) => {
    const before = { id: "room-row", updatedAt: new Date("2026-11-01T10:00:00Z"), scopeClaims: [claim] };
    const current = { ...before, updatedAt: new Date("2026-11-01T10:00:01Z"),
      scopeClaims: [{ ...claim, releaseEpoch: newEpoch }] };
    const expected = structuredClone(current.scopeClaims);
    m.read.mockResolvedValue(before);
    m.write.mockImplementation(async ({ where, data }) => {
      where = { ...where, ...(where.AND ?? {}) };
      if ((where.updatedAt && where.updatedAt.getTime() !== current.updatedAt.getTime())
        || (where.scopeClaims && JSON.stringify(where.scopeClaims.equals) !== JSON.stringify(current.scopeClaims))) {
        throw Object.assign(new Error("snapshot changed"), { code: "P2025" });
      }
      current.scopeClaims = data.scopeClaims;
      return current;
    });
    await run();
    expect(current.scopeClaims).toEqual(expected);
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it.each(operations)("%s retains current protected ownership when its snapshot wins", async (_name, run) => {
    const row = { id: "room-row", updatedAt: new Date("2026-11-01T10:00:00Z"), scopeClaims: [claim] };
    m.read.mockResolvedValue(row);
    m.write.mockImplementation(async ({ data }) => ({ ...row, ...data }));
    await run();
    expect(m.write).toHaveBeenCalledOnce();
    expect(m.write.mock.calls[0][0].data.scopeClaims).toContainEqual(claim);
    expect(m.revalidate).toHaveBeenCalled();
  });
});
