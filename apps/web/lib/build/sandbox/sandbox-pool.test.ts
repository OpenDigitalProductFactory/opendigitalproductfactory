import { beforeEach, describe, expect, it, vi } from "vitest";

// A slot row that outlives its container (seeded as `dpf-sandbox-2` while the
// compose stack only runs `dpf-sandbox-1`) must never be handed to a build, and
// builds already bound to such a container must be healed at pool init.

type SlotRow = {
  id: string;
  slotIndex: number;
  containerId: string;
  port: number;
  status: string;
  buildId: string | null;
  userId: string | null;
  acquiredAt: Date | null;
  releasedAt: Date | null;
};

const state = vi.hoisted(() => ({
  slots: [] as SlotRow[],
  builds: [] as Array<{ buildId: string; phase: string; sandboxId: string | null; sandboxPort: number | null }>,
  upserts: [] as number[],
}));

function matchesIn(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "object" && filter !== null) {
    const f = filter as { in?: unknown[]; notIn?: unknown[]; gte?: number };
    if (f.in) return f.in.includes(value);
    if (f.notIn) return !f.notIn.includes(value);
    if (f.gte !== undefined) return (value as number) >= f.gte;
  }
  return value === filter;
}

function slotMatches(row: SlotRow, where: Record<string, unknown>): boolean {
  if (Array.isArray(where.OR)) {
    return (where.OR as Array<Record<string, unknown>>).some((clause) => slotMatches(row, clause));
  }
  return Object.entries(where).every(([key, filter]) => matchesIn((row as Record<string, unknown>)[key], filter));
}

vi.mock("@dpf/db", () => ({
  prisma: {
    sandboxSlot: {
      upsert: vi.fn(async ({ where, create, update }: { where: { slotIndex: number }; create: Omit<SlotRow, "id" | "acquiredAt" | "releasedAt" | "buildId" | "userId">; update: Partial<SlotRow> }) => {
        state.upserts.push(where.slotIndex);
        const existing = state.slots.find((s) => s.slotIndex === where.slotIndex);
        if (existing) Object.assign(existing, update);
        else state.slots.push({ acquiredAt: null, releasedAt: null, buildId: null, userId: null, ...create, id: `slot-${where.slotIndex}` });
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = state.slots.length;
        state.slots = state.slots.filter((row) => !slotMatches(row, where));
        return { count: before - state.slots.length };
      }),
      findUnique: vi.fn(async ({ where }: { where: { buildId: string } }) => state.slots.find((s) => s.buildId === where.buildId) ?? null),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...state.slots].sort((a, b) => a.slotIndex - b.slotIndex).find((row) => slotMatches(row, where)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SlotRow> }) => {
        const row = state.slots.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    featureBuild: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async ({ where, data }: { where: { phase: { in: string[] }; sandboxId: { notIn: string[] } }; data: { sandboxId: string; sandboxPort: number } }) => {
        let count = 0;
        for (const build of state.builds) {
          if (where.phase.in.includes(build.phase) && !where.sandboxId.notIn.includes(build.sandboxId as string)) {
            Object.assign(build, data);
            count++;
          }
        }
        return { count };
      }),
    },
  },
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: vi.fn(async () => "normal"),
  QuiescingError: class extends Error {},
}));

vi.mock("@/lib/queue/queue-telemetry", () => ({
  recordQueueTransition: vi.fn(async () => undefined),
}));

import { acquireSandboxLease, initializePool } from "./sandbox-pool";

function seedStaleRows() {
  state.slots = [
    { id: "slot-0", slotIndex: 0, containerId: "dpf-sandbox-1", port: 3035, status: "in_use", buildId: "FB-BUSY", userId: "u", acquiredAt: new Date(), releasedAt: null },
    { id: "slot-1", slotIndex: 1, containerId: "dpf-sandbox-2", port: 3037, status: "available", buildId: null, userId: null, acquiredAt: null, releasedAt: null },
    { id: "slot-2", slotIndex: 2, containerId: "dpf-sandbox-3", port: 3038, status: "available", buildId: null, userId: null, acquiredAt: null, releasedAt: null },
  ];
}

beforeEach(() => {
  state.slots = [];
  state.builds = [];
  state.upserts = [];
});

describe("sandbox pool — only configured containers are slots", () => {
  it("acquire never hands out a stale row for a container the stack does not run", async () => {
    seedStaleRows();
    const lease = await acquireSandboxLease({ buildId: "FB-NEW", userId: "u" });
    expect(lease).toBeNull();
    expect(state.slots.find((s) => s.containerId === "dpf-sandbox-2")?.status).toBe("available");
  });

  it("initializePool removes rows outside the configured pool and heals active builds bound to them", async () => {
    seedStaleRows();
    state.builds = [
      { buildId: "FB-REVIEW", phase: "review", sandboxId: "dpf-sandbox-2", sandboxPort: 3037 },
      { buildId: "FB-DONE", phase: "complete", sandboxId: "dpf-sandbox-2", sandboxPort: 3037 },
      { buildId: "FB-OK", phase: "build", sandboxId: "dpf-sandbox-1", sandboxPort: 3035 },
    ];
    await initializePool();
    expect(state.upserts).toEqual([0]);
    expect(state.slots.map((s) => s.containerId)).toEqual(["dpf-sandbox-1"]);
    expect(state.slots[0]?.status).toBe("available");
    expect(state.builds.find((b) => b.buildId === "FB-REVIEW")).toMatchObject({ sandboxId: "dpf-sandbox-1", sandboxPort: 3035 });
    expect(state.builds.find((b) => b.buildId === "FB-DONE")?.sandboxId).toBe("dpf-sandbox-2");
    expect(state.builds.find((b) => b.buildId === "FB-OK")?.sandboxPort).toBe(3035);
  });

  it("acquire hands out the configured slot once it is free", async () => {
    seedStaleRows();
    await initializePool();
    const lease = await acquireSandboxLease({ buildId: "FB-NEW", userId: "u" });
    expect(lease).toMatchObject({ slotIndex: 0, containerId: "dpf-sandbox-1", port: 3035 });
  });
});
