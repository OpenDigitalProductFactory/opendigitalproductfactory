import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    outboundDraft: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { guardDraftArchetypeFit, resolveOrgArchetypeCategory } from "./fit-guard";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockCategory(category: string | null) {
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(
    (category === null
      ? { storefrontConfig: { archetype: { category: null } } }
      : { storefrontConfig: { archetype: { category } } }) as never,
  );
}

describe("resolveOrgArchetypeCategory", () => {
  it("returns the storefront archetype category", async () => {
    mockCategory("food-hospitality");
    expect(await resolveOrgArchetypeCategory("org-1")).toBe("food-hospitality");
  });

  it("returns null when no storefront/archetype is configured", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never);
    expect(await resolveOrgArchetypeCategory("org-1")).toBeNull();
  });
});

describe("guardDraftArchetypeFit", () => {
  it("returns null when the draft does not exist", async () => {
    vi.mocked(prisma.outboundDraft.findUnique).mockResolvedValue(null as never);
    expect(await guardDraftArchetypeFit({ draftId: "missing" })).toBeNull();
  });

  it("blocks a restaurant draft that leaks software-platform language", async () => {
    vi.mocked(prisma.outboundDraft.findUnique).mockResolvedValue({
      body: "Come meet our technical founders behind Build Studio!",
      organizationId: "org-1",
    } as never);
    mockCategory("food-hospitality");

    const result = await guardDraftArchetypeFit({ draftId: "d-1" });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.assessment.blocked).toBe(true);
      expect(result!.error.toLowerCase()).toContain("imported/test data");
    }
  });

  it("passes clean, in-archetype restaurant copy", async () => {
    vi.mocked(prisma.outboundDraft.findUnique).mockResolvedValue({
      body: "Reserve a table for our seasonal tasting menu this weekend.",
      organizationId: "org-1",
    } as never);
    mockCategory("food-hospitality");

    const result = await guardDraftArchetypeFit({ draftId: "d-2" });
    expect(result!.ok).toBe(true);
  });

  it("honors the edited-body override when the operator fixes the leak", async () => {
    vi.mocked(prisma.outboundDraft.findUnique).mockResolvedValue({
      body: "Meet the technical founders behind our AI workflow.",
      organizationId: "org-1",
    } as never);
    mockCategory("food-hospitality");

    const result = await guardDraftArchetypeFit({
      draftId: "d-3",
      contentOverride: "Reserve a table for our seasonal menu tonight.",
    });
    expect(result!.ok).toBe(true);
  });
});
