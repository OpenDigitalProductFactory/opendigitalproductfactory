import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    workroom: { findUnique: vi.fn() },
    featureBuild: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/agent-form-assist", () => ({
  buildFormAssistInstruction: vi.fn(() => "FORM ASSIST INSTRUCTION"),
}));
vi.mock("@/lib/build-agent-prompts", () => ({ getBuildContextSection: vi.fn() }));
vi.mock("@/lib/feature-build-data", () => ({ getFeatureBuildForContext: vi.fn() }));

import { prisma } from "@dpf/db";

import { formAssistSection, resolveRouteBuildId } from "./coworker-context-sections";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formAssistSection", () => {
  it("returns the instruction only when elevated form-fill is enabled AND a context is present", () => {
    const ctx = { formKey: "f1" } as never;
    expect(formAssistSection({ elevatedFormFillEnabled: true, formAssistContext: ctx })).toBe("FORM ASSIST INSTRUCTION");
    expect(formAssistSection({ elevatedFormFillEnabled: false, formAssistContext: ctx })).toBeNull();
    expect(formAssistSection({ elevatedFormFillEnabled: true })).toBeNull();
    expect(formAssistSection({})).toBeNull();
  });
});

describe("resolveRouteBuildId", () => {
  it("returns the explicit buildId unchanged (no route lookup)", async () => {
    const id = await resolveRouteBuildId({ buildId: "BUILD-1", routeContext: "/build/x", userId: "u1" });
    expect(id).toBe("BUILD-1");
    expect(prisma.workroom.findUnique).not.toHaveBeenCalled();
    expect(prisma.featureBuild.findFirst).not.toHaveBeenCalled();
  });

  it("does not resolve off a non-/build route", async () => {
    const id = await resolveRouteBuildId({ routeContext: "/portfolio", userId: "u1" });
    expect(id).toBeUndefined();
    expect(prisma.featureBuild.findFirst).not.toHaveBeenCalled();
  });

  it("resolves the capsule's linked build on a /build/work/<capsule> route", async () => {
    asMock(prisma.workroom.findUnique).mockResolvedValueOnce({ featureBuildId: "fb-1" });
    asMock(prisma.featureBuild.findUnique).mockResolvedValueOnce({ buildId: "BUILD-CAP" });
    const id = await resolveRouteBuildId({ routeContext: "/build/work/WC-ABC123", userId: "u1" });
    expect(id).toBe("BUILD-CAP");
  });

  it("falls back to the latest active build on a bare /build route", async () => {
    asMock(prisma.featureBuild.findFirst).mockResolvedValueOnce({ buildId: "BUILD-LATEST" });
    const id = await resolveRouteBuildId({ routeContext: "/build", userId: "u1" });
    expect(id).toBe("BUILD-LATEST");
    expect(prisma.featureBuild.findFirst).toHaveBeenCalledWith({
      where: { createdById: "u1", phase: { notIn: ["complete", "failed", "abandoned"] } },
      orderBy: { updatedAt: "desc" },
      select: { buildId: true },
    });
  });
});
