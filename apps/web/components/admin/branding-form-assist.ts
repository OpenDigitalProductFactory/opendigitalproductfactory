export type BrandingFormState = {
  companyName: string;
  logoUrl: string;
  tokens: Record<string, string>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function applyBrandingFormAssistUpdates(
  current: BrandingFormState,
  updates: Record<string, unknown>,
): BrandingFormState {
  const next: BrandingFormState = {
    companyName: current.companyName,
    logoUrl: current.logoUrl,
    tokens: {
      ...current.tokens,
    },
  };

  if (isNonEmptyString(updates.companyName)) {
    next.companyName = updates.companyName.trim();
  }

  if (isNonEmptyString(updates.logoUrl)) {
    next.logoUrl = updates.logoUrl.trim();
  }

  if (isNonEmptyString(updates.paletteAccent)) {
    next.tokens.palette_accent = updates.paletteAccent.trim();
  }

  if (isNonEmptyString(updates.paletteBg)) {
    next.tokens.palette_bg = updates.paletteBg.trim();
  }

  if (isNonEmptyString(updates.typographyFontFamily)) {
    next.tokens.typography_fontFamily = updates.typographyFontFamily.trim();
  }

  return next;
}
