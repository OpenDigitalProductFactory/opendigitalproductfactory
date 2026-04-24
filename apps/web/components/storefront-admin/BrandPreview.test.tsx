import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandPreview } from "./BrandPreview";
import type { BrandDesignSystem } from "@/lib/brand/types";

function makeSystem(): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-04-24T08:09:51.966Z",
    sources: [{ kind: "url", ref: "https://managingdigital.com", capturedAt: "2026-04-24T08:09:50.008Z" }],
    identity: {
      name: "Managing Digital: Digital Leadership Strength",
      tagline: "Digital leadership for growing teams",
      description: "A focused advisory brand for digital product leadership.",
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "confident", sampleCopy: [] },
    },
    palette: {
      primary: "#2abb61",
      secondary: null,
      accents: [],
      semantic: {
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
        info: "#3b82f6",
      },
      neutrals: {
        50: "#f9fafb",
        100: "#f3f4f6",
        200: "#e5e7eb",
        300: "#d1d5db",
        400: "#9ca3af",
        500: "#6b7280",
        600: "#4b5563",
        700: "#374151",
        800: "#1f2937",
        900: "#111827",
        950: "#030712",
      },
      surfaces: {
        background: "#ffffff",
        foreground: "#111827",
        muted: "#f3f4f6",
        card: "#ffffff",
        border: "#e5e7eb",
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
    components: { library: "custom", inventory: [], patterns: [] },
    tokens: {
      radii: {},
      spacing: {},
      shadows: {},
      motion: {},
      breakpoints: {},
    },
    confidence: {
      overall: 0.65,
      perField: {},
    },
    gaps: ["no-tailwind-config"],
    overrides: {},
  };
}

describe("BrandPreview", () => {
  it("renders extracted timestamps deterministically for hydration-safe markup", () => {
    const html = renderToStaticMarkup(<BrandPreview system={makeSystem()} />);

    expect(html).toContain("Apr 24, 2026, 8:09 AM UTC");
    expect(html).toContain("Managing Digital: Digital Leadership Strength");
    expect(html).toContain("#2abb61");
  });
});
