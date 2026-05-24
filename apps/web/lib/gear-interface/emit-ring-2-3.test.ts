// apps/web/lib/gear-interface/emit-ring-2-3.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const gearRows = new Map<string, Record<string, unknown>>();
let storefrontConfig: { archetypeId: string } | null = null;
let featureBuild: Record<string, unknown> | null = null;

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findFirst: vi.fn(async () => storefrontConfig),
    },
    featureBuild: {
      findUnique: vi.fn(async () => featureBuild),
    },
    gearInterface: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        return gearRows.get(where.idempotencyKey) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `gear-${gearRows.size + 1}`, ...data };
        gearRows.set(String(data.idempotencyKey), row);
        return row;
      }),
    },
  },
  Prisma: {},
}));

import { emitRing23FromCompletedShip } from "./emit-ring-2-3";
import { prisma } from "@dpf/db";

beforeEach(() => {
  gearRows.clear();
  vi.clearAllMocks();
  storefrontConfig = { archetypeId: "hvac" };
  featureBuild = {
    id: "fb-id-1",
    buildId: "FB-ABC123",
    title: "Add invoice export",
    phase: "ship",
    claimedByAgentId: "agent-build-specialist",
    codingProvider: "claude-cli",
    acceptanceMet: { met: true },
    uxVerificationStatus: "complete",
    abandonedAt: null,
    updatedAt: new Date("2026-05-24T18:00:00Z"),
  };
});

describe("emitRing23FromCompletedShip", () => {
  it("emits a Ring 2→3 outward record with archetypeContext from the active StorefrontConfig", async () => {
    await emitRing23FromCompletedShip("FB-ABC123");
    expect(prisma.gearInterface.create).toHaveBeenCalledOnce();
    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    }).data;
    expect(data.innerRing).toBe(2);
    expect(data.outerRing).toBe(3);
    expect(data.archetypeContext).toBe("hvac");
    expect(data.torqueTechnical).toBe(1.0);
    expect(data.outcomeType).toBe("transmission");
  });

  it("skips honestly when no StorefrontConfig exists — does not emit", async () => {
    storefrontConfig = null;
    await emitRing23FromCompletedShip("FB-ABC123");
    expect(prisma.gearInterface.create).not.toHaveBeenCalled();
  });

  it("is no-op when phase is not 'ship'", async () => {
    featureBuild!.phase = "build";
    await emitRing23FromCompletedShip("FB-ABC123");
    expect(prisma.gearInterface.create).not.toHaveBeenCalled();
  });

  it("emits a slip when build was abandoned before completion", async () => {
    featureBuild!.abandonedAt = new Date("2026-05-24T17:30:00Z");
    await emitRing23FromCompletedShip("FB-ABC123");
    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    }).data;
    expect(data.outcomeType).toBe("slip");
    expect(data.torqueTechnical).toBe(0);
  });

  it("emits with torque=0.25 when acceptance was explicitly rejected", async () => {
    featureBuild!.acceptanceMet = { met: false };
    await emitRing23FromCompletedShip("FB-ABC123");
    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    }).data;
    expect(data.torqueTechnical).toBe(0.25);
    expect(data.outcomeType).toBe("slip");
  });

  it("is idempotent — second call with the same build reuses the row", async () => {
    await emitRing23FromCompletedShip("FB-ABC123");
    await emitRing23FromCompletedShip("FB-ABC123");
    expect(prisma.gearInterface.create).toHaveBeenCalledOnce();
    expect(gearRows.size).toBe(1);
  });
});
