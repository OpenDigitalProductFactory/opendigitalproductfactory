export type BrandingFormState = {
  companyName: string;
  logoUrl: string;
  tokens: Record<string, string>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const TOKEN_FIELD_MAP: Record<string, string> = {
  paletteAccent: "palette_accent", paletteBg: "palette_bg",
  paletteSurface1: "palette_surface1", paletteSurface2: "palette_surface2",
  paletteMuted: "palette_muted", paletteBorder: "palette_border",
  surfacesPage: "surfaces_page", surfacesPanel: "surfaces_panel",
  surfacesCard: "surfaces_card", surfacesSidebar: "surfaces_sidebar", surfacesModal: "surfaces_modal",
  statesIdle: "states_idle", statesHover: "states_hover", statesActive: "states_active",
  statesFocus: "states_focus", statesSuccess: "states_success", statesWarning: "states_warning",
  statesError: "states_error", statesInfo: "states_info",
  typographyFontFamily: "typography_fontFamily", typographyHeadingFontFamily: "typography_headingFontFamily",
  spacingXs: "spacing_xs", spacingSm: "spacing_sm", spacingMd: "spacing_md",
  spacingLg: "spacing_lg", spacingXl: "spacing_xl",
  radiusSm: "radius_sm", radiusMd: "radius_md", radiusLg: "radius_lg", radiusXl: "radius_xl",
  shadowsPanel: "shadows_panel", shadowsCard: "shadows_card", shadowsButton: "shadows_button",
};

export function applyBrandingFormAssistUpdates(
  current: BrandingFormState,
  updates: Record<string, unknown>,
): BrandingFormState {
  const next: BrandingFormState = {
    companyName: current.companyName,
    logoUrl: current.logoUrl,
    tokens: { ...current.tokens },
  };

  if (isNonEmptyString(updates.companyName)) next.companyName = updates.companyName.trim();
  if (isNonEmptyString(updates.logoUrl)) next.logoUrl = updates.logoUrl.trim();

  for (const [fieldName, tokenKey] of Object.entries(TOKEN_FIELD_MAP)) {
    if (isNonEmptyString(updates[fieldName])) {
      next.tokens[tokenKey] = (updates[fieldName] as string).trim();
    }
  }

  return next;
}
