// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { resolveCanvasTheme } from "./canvas-theme";

describe("resolveCanvasTheme", () => {
  it("returns concrete active-theme values for Canvas2D", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "rgb(18, 24, 32)",
      getPropertyValue: (name: string) => ({
        "--dpf-text": " rgb(18, 24, 32) ",
        "--dpf-muted": " rgb(82, 96, 110) ",
        "--dpf-border": " rgb(190, 198, 207) ",
        "--dpf-surface-1": " rgb(250, 251, 252) ",
        "--dpf-accent": " rgb(37, 99, 235) ",
        "--dpf-success": " rgb(22, 163, 74) ",
      })[name] ?? "",
    } as CSSStyleDeclaration);

    expect(resolveCanvasTheme(canvas)).toMatchObject({
      text: "rgb(18, 24, 32)",
      muted: "rgb(82, 96, 110)",
      border: "rgb(190, 198, 207)",
      surface: "rgb(250, 251, 252)",
      accent: "rgb(37, 99, 235)",
      success: "rgb(22, 163, 74)",
      isDark: false,
    });
  });
});
