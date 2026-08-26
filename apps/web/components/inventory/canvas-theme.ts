import { useEffect, useState, type RefObject } from "react";

export type CanvasTheme = {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  success: string;
  isDark: boolean;
  edgeAlpha: number;
};

const FALLBACK_THEME: CanvasTheme = {
  text: "CanvasText",
  muted: "GrayText",
  border: "ButtonBorder",
  surface: "Canvas",
  accent: "Highlight",
  success: "LinkText",
  isDark: false,
  edgeAlpha: 0.55,
};

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function isDarkColor(color: string): boolean {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) return false;
  const [red = 255, green = 255, blue = 255] = channels;
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) < 128;
}

export function resolveCanvasTheme(canvas: HTMLCanvasElement): CanvasTheme {
  const styles = window.getComputedStyle(canvas);
  const surface = token(styles, "--dpf-surface-1", FALLBACK_THEME.surface);
  const isDark = isDarkColor(surface);
  return {
    text: token(styles, "--dpf-text", styles.color || FALLBACK_THEME.text),
    muted: token(styles, "--dpf-muted", FALLBACK_THEME.muted),
    border: token(styles, "--dpf-border", FALLBACK_THEME.border),
    surface,
    accent: token(styles, "--dpf-accent", FALLBACK_THEME.accent),
    success: token(styles, "--dpf-success", FALLBACK_THEME.success),
    isDark,
    edgeAlpha: isDark ? 0.3 : 0.55,
  };
}

export function resolveCanvasColor(
  canvas: HTMLCanvasElement,
  color: string | undefined,
  fallback: string,
): string {
  if (!color) return fallback;
  const match = color.match(/^var\((--[^,\s)]+)/);
  if (!match?.[1]) return color;
  return window.getComputedStyle(canvas).getPropertyValue(match[1]).trim() || fallback;
}

function sameTheme(left: CanvasTheme, right: CanvasTheme): boolean {
  return Object.keys(left).every((key) => left[key as keyof CanvasTheme] === right[key as keyof CanvasTheme]);
}

export function useCanvasTheme(canvasRef: RefObject<HTMLCanvasElement | null>): CanvasTheme {
  const [theme, setTheme] = useState<CanvasTheme>(FALLBACK_THEME);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const refresh = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const next = resolveCanvasTheme(canvas);
      setTheme((current) => sameTheme(current, next) ? current : next);
    };

    refresh();
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(refresh);
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    if (observer && document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    const preference = window.matchMedia?.("(prefers-color-scheme: dark)");
    preference?.addEventListener("change", refresh);
    return () => {
      observer?.disconnect();
      preference?.removeEventListener("change", refresh);
    };
  }, [canvasRef]);

  return theme;
}
