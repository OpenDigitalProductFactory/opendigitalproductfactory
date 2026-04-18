import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrandDesignSystem } from "@/lib/brand/types";

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  organizationUpdate: vi.fn(),
  brandingConfigUpsert: vi.fn(),
  designSystemToThemeTokens: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findUnique: mocks.organizationFindUnique,
      update: mocks.organizationUpdate,
    },
    brandingConfig: {
      upsert: mocks.brandingConfigUpsert,
    },
  },
}));

vi.mock("@/lib/brand/apply", () => ({
  designSystemToThemeTokens: mocks.designSystemToThemeTokens,
}));

import { applyBrandDesignSystem } from "./apply-brand-design-system";

function sampleSystem(overrides?: Partial<BrandDesignSystem>): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-04-18T00:00:00.000Z",
    sources: [],
    identity: {
      name: "Acme",
      tagline: null,
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "neutral", sampleCopy: [] },
    },
    palette: {
      primary: "#336699",
      secondary: null,
      accents: [],
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#fff", 100: "#f9f9f9", 200: "#eee", 300: "#ddd", 400: "#bbb",
        500: "#888", 600: "#666", 700: "#444", 800: "#222", 900: "#111", 950: "#000",
      },
      surfaces: {
        background: "#fff", foreground: "#000", muted: "#f5f5f5", card: "#fff", border: "#e5e5e5",
      },
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
    confidence: { overall: 0.7, perField: {} },
    gaps: [],
    overrides: {},
    ...overrides,
  };
}

describe("applyBrandDesignSystem", () => {
  beforeEach(() => {
    mocks.organizationFindUnique.mockReset();
    mocks.organizationUpdate.mockReset();
    mocks.brandingConfigUpsert.mockReset();
    mocks.designSystemToThemeTokens.mockReset();

    mocks.organizationUpdate.mockResolvedValue({});
    mocks.brandingConfigUpsert.mockResolvedValue({});
    mocks.designSystemToThemeTokens.mockReturnValue({ dark: { tag: "dark-tokens" }, light: { tag: "light-tokens" } });
  });

  it("returns an error when no BrandDesignSystem has been extracted yet", async () => {
    mocks.organizationFindUnique.mockResolvedValue({ designSystem: null });

    const result = await applyBrandDesignSystem("org-1");

    expect(result.success).toBe(false);
    expect(mocks.brandingConfigUpsert).not.toHaveBeenCalled();
  });

  it("writes overrides onto Organization.designSystem.overrides", async () => {
    mocks.organizationFindUnique.mockResolvedValue({ designSystem: sampleSystem() });

    const result = await applyBrandDesignSystem("org-1", {
      palette: { primary: "#ff00aa" } as unknown as BrandDesignSystem["palette"],
    });

    expect(result.success).toBe(true);
    expect(mocks.organizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: expect.objectContaining({
          designSystem: expect.objectContaining({
            overrides: expect.objectContaining({
              palette: expect.objectContaining({ primary: "#ff00aa" }),
            }),
          }),
        }),
      }),
    );
  });

  it("refreshes BrandingConfig.tokens via the shared mapper", async () => {
    mocks.organizationFindUnique.mockResolvedValue({ designSystem: sampleSystem() });

    await applyBrandDesignSystem("org-1");

    expect(mocks.designSystemToThemeTokens).toHaveBeenCalled();
    expect(mocks.brandingConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope: "organization:org-1" },
      }),
    );
  });

  it("passes the merged system (overrides applied) to the mapper, not the raw system", async () => {
    mocks.organizationFindUnique.mockResolvedValue({ designSystem: sampleSystem() });

    await applyBrandDesignSystem("org-1", {
      palette: { primary: "#ff00aa" } as unknown as BrandDesignSystem["palette"],
    });

    const mapperArg = mocks.designSystemToThemeTokens.mock.calls[0]?.[0] as BrandDesignSystem;
    expect(mapperArg.palette.primary).toBe("#ff00aa");
  });
});
