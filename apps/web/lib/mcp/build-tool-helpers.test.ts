import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    buildActivity: { create: vi.fn(() => ({ catch: () => {} })) },
  },
}));
vi.mock("@dpf/db", () => db);
vi.mock("@/lib/feature-build-types", () => ({
  mergeHappyPathStateIntoPlan: (plan: unknown, patch: unknown) => ({ ...(plan as object), ...(patch as object) }),
}));

import {
  extractBuildIdHint,
  TERMINAL_BUILD_PHASES,
  resolveActiveBuildId,
} from "./build-tool-helpers";

beforeEach(() => vi.clearAllMocks());

describe("build-tool-helpers", () => {
  it("extractBuildIdHint accepts only FB- prefixed strings", () => {
    expect(extractBuildIdHint({ buildId: "FB-ABC123" })).toBe("FB-ABC123");
    expect(extractBuildIdHint({ buildId: "  FB-TRIM  " })).toBe("FB-TRIM");
    expect(extractBuildIdHint({ buildId: "nope" })).toBeNull();
    expect(extractBuildIdHint({ buildId: 42 })).toBeNull();
    expect(extractBuildIdHint({})).toBeNull();
  });

  it("extractBuildIdHint also reads featureBuildId and FB tokens in routeContext (BI-PIR-9a75015d)", () => {
    expect(extractBuildIdHint({ featureBuildId: "FB-ALT1" })).toBe("FB-ALT1");
    expect(extractBuildIdHint({ routeContext: "/build/FB-041879CD" })).toBe("FB-041879CD");
    expect(extractBuildIdHint({ path: "working on FB-DEADBEEF now" })).toBe("FB-DEADBEEF");
  });

  it("TERMINAL_BUILD_PHASES excludes terminal builds from active resolution", () => {
    expect([...TERMINAL_BUILD_PHASES]).toEqual(["complete", "failed", "abandoned"]);
  });

  it("resolveActiveBuildId honours an owned FB- hint over the fallback", async () => {
    db.prisma.featureBuild.findUnique.mockResolvedValue({ buildId: "FB-HINT", createdById: "u1" });
    const id = await resolveActiveBuildId("u1", "FB-HINT");
    expect(id).toBe("FB-HINT");
    // Hint wins — the fallback resolve/ambiguity queries are never run.
    expect(db.prisma.featureBuild.findFirst).not.toHaveBeenCalled();
    expect(db.prisma.featureBuild.count).not.toHaveBeenCalled();
  });

  it("resolveActiveBuildId ignores a hint owned by another user and falls back to the single active build", async () => {
    db.prisma.featureBuild.findUnique.mockResolvedValue({ buildId: "FB-OTHER", createdById: "other" });
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-FALLBACK" });
    db.prisma.featureBuild.count.mockResolvedValue(1);
    const id = await resolveActiveBuildId("u1", "FB-OTHER");
    expect(id).toBe("FB-FALLBACK");
  });

  it("resolveActiveBuildId returns null when the user has no non-terminal build", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue(null);
    expect(await resolveActiveBuildId("u1")).toBeNull();
    // No point counting when there is no build at all.
    expect(db.prisma.featureBuild.count).not.toHaveBeenCalled();
  });

  // BI-F82915D7: refuse to guess when the fallback is ambiguous rather than
  // silently returning the most-recent build (cross-build contamination).
  it("resolveActiveBuildId refuses (returns null) when many non-terminal builds share sandbox-hot phases", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-A" });
    db.prisma.featureBuild.count.mockResolvedValue(2);
    db.prisma.featureBuild.findMany.mockResolvedValue([
      { buildId: "FB-A", phase: "build" },
      { buildId: "FB-B", phase: "review" },
    ]);
    expect(await resolveActiveBuildId("u1")).toBeNull();
  });

  it("resolveActiveBuildId picks the sole sandbox-hot build among drafts (BI-PIR-9a75015d)", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-STALE" });
    db.prisma.featureBuild.count.mockResolvedValue(3);
    db.prisma.featureBuild.findMany.mockResolvedValue([
      { buildId: "FB-STALE", phase: "ideate" },
      { buildId: "FB-041879CD", phase: "review" },
      { buildId: "FB-OTHER", phase: "plan" },
    ]);
    expect(await resolveActiveBuildId("u1")).toBe("FB-041879CD");
  });

  // Back-compat: a mock without `count` (the common single-build pack test) must
  // still resolve — a missing count safely means "unambiguous".
  it("resolveActiveBuildId resolves the fallback when count is not mocked (single-build pack tests)", async () => {
    const dbNoCount = db.prisma.featureBuild as unknown as { count?: unknown };
    const savedCount = dbNoCount.count;
    delete dbNoCount.count;
    try {
      db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-SOLO" });
      expect(await resolveActiveBuildId("u1")).toBe("FB-SOLO");
    } finally {
      dbNoCount.count = savedCount;
    }
  });
});
