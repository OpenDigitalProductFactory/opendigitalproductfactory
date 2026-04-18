import { deriveThemeTokens, type DualThemeTokens } from "@/lib/release/branding-presets";
import type { BrandDesignSystem } from "./types";

/**
 * Map a BrandDesignSystem to the runtime theme DualThemeTokens shape used
 * by the storefront/admin themers. Shared by the extraction side-effect
 * (Task 2.8, Inngest function) and the preview-and-apply flow (PR 3).
 *
 * Strategy:
 * - Seed tokens via deriveThemeTokens(primary) so contrast/state colors
 *   are computed from the accent automatically.
 * - Override typography fontFamily/headingFontFamily from extracted
 *   families.
 * - Propagate semantic palette entries (success/warning/danger/info)
 *   into states, preserving extracted values over derived defaults.
 */
export function designSystemToThemeTokens(system: BrandDesignSystem): DualThemeTokens {
  const primary = system.palette.primary;
  const baseTokens = deriveThemeTokens(primary);

  const sans = system.typography.families.sans;
  const display = system.typography.families.display ?? sans;
  const fontFamily = `${sans}, sans-serif`;
  const headingFontFamily = `${display}, sans-serif`;

  const applySemantic = (tokens: DualThemeTokens["dark"]): DualThemeTokens["dark"] => ({
    ...tokens,
    typography: {
      ...tokens.typography,
      fontFamily,
      headingFontFamily,
    },
    states: {
      ...tokens.states,
      success: system.palette.semantic.success,
      warning: system.palette.semantic.warning,
      error: system.palette.semantic.danger,
      info: system.palette.semantic.info,
    },
  });

  return {
    dark: applySemantic(baseTokens.dark),
    light: applySemantic(baseTokens.light),
  };
}
