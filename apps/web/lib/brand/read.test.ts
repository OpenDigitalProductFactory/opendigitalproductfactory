import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrandDesignSystem } from "./types";

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  organizationFindFirst: vi.fn(),
  storefrontFindUnique: vi.fn(),
  storefrontFindFirst: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findUnique: mocks.organizationFindUnique,
      findFirst: mocks.organizationFindFirst,
    },
    storefrontConfig: {
      findUnique: mocks.storefrontFindUnique,
      findFirst: mocks.storefrontFindFirst,
    },
  },
}));

import { readBrandContext } from "./read";

function makeValidDesignSystem(name = "Acme"): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-04-18T00:00:00.000Z",
    sources: [],
    identity: {
      name,
      tagline: null,
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "neutral", sampleCopy: [] },
    },
    palette: {
      primary: "#000",
      secondary: null,
      accents: [],
      semantic: { success: "#0a0", warning: "#a60", danger: "#a00", info: "#00a" },
      neutrals: {
        50: "#fff", 100: "#f9f9f9", 200: "#eee", 300: "#ddd", 400: "#bbb",
        500: "#888", 600: "#666", 700: "#444", 800: "#222", 900: "#111", 950: "#000",
      },
      surfaces: { background: "#fff", foreground: "#000", muted: "#f5f5f5", card: "#fff", border: "#e5e5e5" },
    },
    typography: {
      families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
      scale: {
        xs: { size: "0.75rem", lineHeight: "1rem", tracking: "0", weight: 400 },
        sm: { size: "0.875rem", lineHeight: "1.25rem", tracking: "0", weight: 400 },
        base: { size: "1rem", lineHeight: "1.5rem", tracking: "0", weight: 400 },
        lg: { size: "1.125rem", lineHeight: "1.75rem", tracking: "0", weight: 400 },
        xl: { size: "1.25rem", lineHeight: "1.75rem", tracking: "0", weight: 500 },
        "2xl": { size: "1.5rem", lineHeight: "2rem", tracking: "0", weight: 600 },
        "3xl": { size: "1.875rem", lineHeight: "2.25rem", tracking: "0", weight: 700 },
        "4xl": { size: "2.25rem", lineHeight: "2.5rem", tracking: "0", weight: 700 },
        "5xl": { size: "3rem", lineHeight: "1", tracking: "0", weight: 700 },
        "6xl": { size: "3.75rem", lineHeight: "1", tracking: "0", weight: 700 },
      },
      pairings: [],
    },
    components: { library: "shadcn", inventory: [], patterns: [] },
    tokens: { radii: {}, spacing: {}, shadows: {}, motion: {}, breakpoints: {} },
    confidence: { overall: 0.5, perField: {} },
    gaps: [],
    overrides: {},
  };
}

describe("readBrandContext", () => {
  beforeEach(() => {
    mocks.organizationFindUnique.mockReset();
    mocks.organizationFindFirst.mockReset();
    mocks.storefrontFindUnique.mockReset();
    mocks.storefrontFindFirst.mockReset();
  });

  it("returns structured when organization.designSystem is valid", async () => {
    const ds = makeValidDesignSystem("Acme");
    mocks.organizationFindUnique.mockResolvedValue({
      designSystem: ds,
      storefrontConfig: null,
    });

    const result = await readBrandContext({ organizationId: "org-1" });

    expect(result.source).toBe("organization");
    expect(result.structured?.identity.name).toBe("Acme");
    expect(result.legacyMarkdown).toBeNull();
    expect(mocks.organizationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } }),
    );
  });

  it("falls back to storefront legacy blob when org.designSystem is null", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      designSystem: null,
      storefrontConfig: { id: "sf-1", designSystem: "# Legacy markdown blob" },
    });

    const result = await readBrandContext({ organizationId: "org-1" });

    expect(result.source).toBe("storefront");
    expect(result.structured).toBeNull();
    expect(result.legacyMarkdown).toBe("# Legacy markdown blob");
  });

  it("resolves org via storefrontId when no organizationId is given", async () => {
    const ds = makeValidDesignSystem("FromStorefront");
    mocks.storefrontFindUnique.mockResolvedValue({
      designSystem: "ignored-legacy",
      organizationId: "org-2",
    });
    mocks.organizationFindUnique.mockResolvedValue({ designSystem: ds });

    const result = await readBrandContext({ storefrontId: "sf-1" });

    expect(result.source).toBe("organization");
    expect(result.structured?.identity.name).toBe("FromStorefront");
    expect(mocks.storefrontFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sf-1" } }),
    );
  });

  it("single-org fallback: no IDs passed, the only org has a structured designSystem", async () => {
    const ds = makeValidDesignSystem("SoleOrg");
    mocks.organizationFindFirst.mockResolvedValue({ designSystem: ds });

    const result = await readBrandContext({});

    expect(result.source).toBe("organization");
    expect(result.structured?.identity.name).toBe("SoleOrg");
    expect(result.legacyMarkdown).toBeNull();
    expect(mocks.organizationFindFirst).toHaveBeenCalled();
    expect(mocks.storefrontFindFirst).not.toHaveBeenCalled();
  });

  it("legacy fallback: no IDs passed, org has no designSystem but a storefront has legacy blob", async () => {
    mocks.organizationFindFirst.mockResolvedValue({ designSystem: null });
    mocks.storefrontFindFirst.mockResolvedValue({ designSystem: "# Any storefront blob" });

    const result = await readBrandContext({});

    expect(result.source).toBe("storefront");
    expect(result.legacyMarkdown).toBe("# Any storefront blob");
    expect(result.structured).toBeNull();
    expect(mocks.storefrontFindFirst).toHaveBeenCalled();
  });

  it("returns source: none when no IDs, no org designSystem, and no storefronts exist", async () => {
    mocks.organizationFindFirst.mockResolvedValue(null);
    mocks.storefrontFindFirst.mockResolvedValue(null);

    const result = await readBrandContext({});

    expect(result.source).toBe("none");
    expect(result.structured).toBeNull();
    expect(result.legacyMarkdown).toBeNull();
  });
});
