/**
 * Mobile design tokens + a runtime theme store.
 *
 * The app ships sensible defaults, but the connected install drives the design:
 * after login the app fetches the install manifest (see appConfig.ts) and applies
 * its branding tokens here, so one generic binary re-themes per organization.
 * See docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html (§3).
 */
import { create } from "zustand";
import type {
  BrandingThemeTokens,
  DualBrandingThemeTokens,
} from "@/src/lib/manifest.types";

export interface ThemeColors {
  primary: string;
  surface1: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  white: string;
}

export const defaultColors: ThemeColors = {
  primary: "#818cf8", // indigo-400
  surface1: "#1e1e2e", // app background
  surface2: "#2a2a3e", // card background
  border: "#3a3a4e",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
  white: "#ffffff",
};

/**
 * Back-compat default export. Components not yet migrated to `useTheme()` import
 * this static set; migrated components read the live (install-themed) colors.
 */
export const colors = defaultColors;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const borderRadius = { sm: 6, md: 12, lg: 16 };

export type ColorScheme = "light" | "dark";

function isDual(
  t: BrandingThemeTokens | DualBrandingThemeTokens,
): t is DualBrandingThemeTokens {
  const d = t as DualBrandingThemeTokens;
  return d.light !== undefined || d.dark !== undefined;
}

/**
 * Pure mapper: install branding tokens → the mobile color set. Maps the keys the
 * install actually carries onto the mobile names, falling back to defaults for
 * anything absent (success/warning/error are not branding-driven today).
 */
export function brandingTokensToColors(
  tokens: BrandingThemeTokens | DualBrandingThemeTokens | null | undefined,
  scheme: ColorScheme = "dark",
): ThemeColors {
  if (!tokens) return { ...defaultColors };
  const single: BrandingThemeTokens | undefined = isDual(tokens)
    ? (scheme === "dark" ? tokens.dark : tokens.light) ?? tokens.light ?? tokens.dark
    : tokens;
  const palette = single?.palette ?? {};
  return {
    ...defaultColors,
    primary: palette.accent ?? defaultColors.primary,
    surface1: palette.bg ?? defaultColors.surface1, // bg → app background
    surface2: palette.surface1 ?? defaultColors.surface2, // surface1 → cards
    border: palette.border ?? defaultColors.border,
    text: palette.text ?? defaultColors.text,
    textMuted: palette.muted ?? defaultColors.textMuted,
  };
}

interface ThemeState {
  colors: ThemeColors;
  applyBrandingTokens: (
    tokens: BrandingThemeTokens | DualBrandingThemeTokens | null | undefined,
    scheme?: ColorScheme,
  ) => void;
  reset: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  colors: { ...defaultColors },
  applyBrandingTokens: (tokens, scheme = "dark") =>
    set({ colors: brandingTokensToColors(tokens, scheme) }),
  reset: () => set({ colors: { ...defaultColors } }),
}));

/** Component hook: live install-themed colors + the static spacing/radius scales. */
export function useTheme() {
  const themed = useThemeStore((s) => s.colors);
  return { colors: themed, spacing, borderRadius };
}
