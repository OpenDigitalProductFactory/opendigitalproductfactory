import {
  brandingTokensToColors,
  defaultColors,
  useThemeStore,
} from "./theme";

describe("brandingTokensToColors", () => {
  it("returns defaults for null / undefined", () => {
    expect(brandingTokensToColors(null)).toEqual(defaultColors);
    expect(brandingTokensToColors(undefined)).toEqual(defaultColors);
  });

  it("maps a single token set's palette onto the mobile color names", () => {
    const c = brandingTokensToColors({
      palette: {
        accent: "#1e6f50",
        bg: "#0a0a0a",
        surface1: "#111111",
        text: "#fafafa",
        muted: "#888888",
        border: "#222222",
      },
    });
    expect(c.primary).toBe("#1e6f50");
    expect(c.surface1).toBe("#0a0a0a"); // palette.bg → app background
    expect(c.surface2).toBe("#111111"); // palette.surface1 → cards
    expect(c.text).toBe("#fafafa");
    expect(c.textMuted).toBe("#888888");
    expect(c.border).toBe("#222222");
  });

  it("keeps defaults for keys the install does not carry (success/warning/error)", () => {
    const c = brandingTokensToColors({ palette: { accent: "#abcabc" } });
    expect(c.primary).toBe("#abcabc");
    expect(c.surface1).toBe(defaultColors.surface1);
    expect(c.success).toBe(defaultColors.success);
    expect(c.warning).toBe(defaultColors.warning);
    expect(c.error).toBe(defaultColors.error);
  });

  it("selects the requested scheme from dual tokens", () => {
    const dual = {
      light: { palette: { accent: "#ffffff" } },
      dark: { palette: { accent: "#000000" } },
    };
    expect(brandingTokensToColors(dual, "light").primary).toBe("#ffffff");
    expect(brandingTokensToColors(dual, "dark").primary).toBe("#000000");
  });

  it("falls back across schemes when the requested one is absent", () => {
    const onlyLight = { light: { palette: { accent: "#123123" } } };
    expect(brandingTokensToColors(onlyLight, "dark").primary).toBe("#123123");
  });
});

describe("useThemeStore", () => {
  beforeEach(() => useThemeStore.getState().reset());

  it("starts at defaults", () => {
    expect(useThemeStore.getState().colors).toEqual(defaultColors);
  });

  it("applyBrandingTokens re-themes the store", () => {
    useThemeStore
      .getState()
      .applyBrandingTokens({ palette: { accent: "#123456" } }, "dark");
    expect(useThemeStore.getState().colors.primary).toBe("#123456");
  });

  it("reset restores defaults", () => {
    useThemeStore.getState().applyBrandingTokens({ palette: { accent: "#123456" } });
    useThemeStore.getState().reset();
    expect(useThemeStore.getState().colors).toEqual(defaultColors);
  });
});
