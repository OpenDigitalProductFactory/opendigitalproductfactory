import { describe, expect, it } from "vitest";
import { extractBrandDesignSystemFromTaskResponse } from "./task-artifacts";

describe("extractBrandDesignSystemFromTaskResponse", () => {
  it("returns the canonical design system artifact from the internal task payload", () => {
    const system = {
      version: "1.0.0",
      extractedAt: "2026-04-24T08:18:37.033Z",
      sources: [],
      identity: {
        name: "Example Domain",
        tagline: null,
        description: null,
        logo: { darkBg: null, lightBg: null, mark: null },
        voice: { tone: "clear", sampleCopy: [] },
      },
      palette: {
        primary: "#334488",
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
        overall: 0.7,
        perField: {},
      },
      gaps: [],
      overrides: {},
    };

    const result = extractBrandDesignSystemFromTaskResponse({
      task: {
        taskId: "TR-BRAND-123",
        artifacts: [
          {
            artifactId: "ta-theme",
            name: "Derived brand theme tokens",
            parts: [{ type: "theme-tokens", data: { light: {} } }],
          },
          {
            artifactId: "ta-design",
            name: "Extracted brand design system",
            parts: [{ type: "design-system", data: system }],
          },
        ],
      },
    });

    expect(result).toEqual(system);
  });

  it("returns null when the task payload does not contain a valid design system artifact", () => {
    const result = extractBrandDesignSystemFromTaskResponse({
      task: {
        taskId: "TR-BRAND-123",
        artifacts: [
          {
            artifactId: "ta-theme",
            name: "Derived brand theme tokens",
            parts: [{ type: "theme-tokens", data: { light: {} } }],
          },
        ],
      },
    });

    expect(result).toBeNull();
  });
});
