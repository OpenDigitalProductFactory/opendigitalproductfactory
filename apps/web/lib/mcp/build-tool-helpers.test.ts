import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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

  it("TERMINAL_BUILD_PHASES excludes terminal builds from active resolution", () => {
    expect([...TERMINAL_BUILD_PHASES]).toEqual(["complete", "failed", "abandoned"]);
  });

  it("resolveActiveBuildId honours an owned FB- hint over the fallback", async () => {
    db.prisma.featureBuild.findUnique.mockResolvedValue({ buildId: "FB-HINT", createdById: "u1" });
    const id = await resolveActiveBuildId("u1", "FB-HINT");
    expect(id).toBe("FB-HINT");
    expect(db.prisma.featureBuild.findFirst).not.toHaveBeenCalled();
  });

  it("resolveActiveBuildId ignores a hint owned by another user and falls back", async () => {
    db.prisma.featureBuild.findUnique.mockResolvedValue({ buildId: "FB-OTHER", createdById: "other" });
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-FALLBACK" });
    const id = await resolveActiveBuildId("u1", "FB-OTHER");
    expect(id).toBe("FB-FALLBACK");
  });

  it("resolveActiveBuildId returns null when the user has no non-terminal build", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue(null);
    expect(await resolveActiveBuildId("u1")).toBeNull();
  });
});
