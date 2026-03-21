"use server";

import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { deriveThemeTokens, validateTokenContrast, type Correction, type ThemeTokens } from "@/lib/branding-presets";
import {
  fetchPublicWebsiteEvidence,
  analyzePublicWebsiteBranding,
  type BrandingAnalysisResult,
} from "@/lib/public-web-tools";

function readString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildThemeTokens(formData: FormData): Prisma.InputJsonValue {
  const tokenValue = (key: string) => readString(formData.get(key));

  return {
    version: tokenValue("version") || "1.0.0",
    palette: {
      bg: tokenValue("palette_bg"),
      surface1: tokenValue("palette_surface1"),
      surface2: tokenValue("palette_surface2"),
      accent: tokenValue("palette_accent"),
      muted: tokenValue("palette_muted"),
      border: tokenValue("palette_border"),
      text: tokenValue("palette_text") || "",
    },
    typography: {
      fontFamily: tokenValue("typography_fontFamily"),
      headingFontFamily: tokenValue("typography_headingFontFamily"),
    },
    spacing: {
      xs: tokenValue("spacing_xs"),
      sm: tokenValue("spacing_sm"),
      md: tokenValue("spacing_md"),
      lg: tokenValue("spacing_lg"),
      xl: tokenValue("spacing_xl"),
    },
    radius: {
      sm: tokenValue("radius_sm"),
      md: tokenValue("radius_md"),
      lg: tokenValue("radius_lg"),
      xl: tokenValue("radius_xl"),
    },
    surfaces: {
      page: tokenValue("surfaces_page"),
      panel: tokenValue("surfaces_panel"),
      card: tokenValue("surfaces_card"),
      sidebar: tokenValue("surfaces_sidebar"),
      modal: tokenValue("surfaces_modal"),
    },
    states: {
      idle: tokenValue("states_idle"),
      hover: tokenValue("states_hover"),
      active: tokenValue("states_active"),
      focus: tokenValue("states_focus"),
      success: tokenValue("states_success"),
      warning: tokenValue("states_warning"),
      error: tokenValue("states_error"),
      info: tokenValue("states_info"),
    },
    shadows: {
      panel: tokenValue("shadows_panel"),
      card: tokenValue("shadows_card"),
      button: tokenValue("shadows_button"),
    },
  } satisfies Prisma.InputJsonObject;
}

function resolvePresetScope(formData: FormData): string {
  const submittedScope = readString(formData.get("scope"));
  if (submittedScope && submittedScope !== "custom" && submittedScope !== "organization") {
    return submittedScope;
  }

  const companyName = readString(formData.get("companyName"));
  const slug = slugify(companyName || "custom");
  return `theme-preset:${slug}`;
}

function revalidateBrandingSurfaces(): void {
  revalidatePath("/admin");
  revalidatePath("/workspace");
  revalidatePath("/portfolio");
  revalidatePath("/ea");
  revalidatePath("/s", "layout");
}

function validateAndCorrectDualTokens(
  dualTokens: { dark: unknown; light: unknown }
): { corrected: { dark: ThemeTokens; light: ThemeTokens }; corrections: Correction[] } {
  const allCorrections: Correction[] = [];

  const darkResult = validateTokenContrast(dualTokens.dark as ThemeTokens, "dark");
  allCorrections.push(...darkResult.corrections);

  const lightResult = validateTokenContrast(dualTokens.light as ThemeTokens, "light");
  allCorrections.push(...lightResult.corrections);

  return {
    corrected: { dark: darkResult.correctedTokens, light: lightResult.correctedTokens },
    corrections: allCorrections,
  };
}

export async function saveThemePreset(formData: FormData): Promise<{ corrections: Correction[] }> {
  const scope = resolvePresetScope(formData);
  const label = readString(formData.get("companyName")) || "Custom";
  const tokens = buildThemeTokens(formData);
  const accent = readString(formData.get("palette_accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("typography_fontFamily")) || undefined;
  const { light } = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);
  const rawDual = { dark: tokens, light };
  const { corrected, corrections } = validateAndCorrectDualTokens(rawDual as any);

  await prisma.brandingConfig.upsert({
    where: { scope },
    update: { label, tokens: corrected as unknown as Prisma.InputJsonValue },
    create: { scope, label, tokens: corrected as unknown as Prisma.InputJsonValue },
  });

  revalidateBrandingSurfaces();
  return { corrections };
}

export async function saveActiveThemePreset(formData: FormData): Promise<{ corrections: Correction[] }> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const tokens = buildThemeTokens(formData);
  const accent = readString(formData.get("palette_accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("typography_fontFamily")) || undefined;
  const { light } = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);
  const rawDual = { dark: tokens, light };
  const { corrected, corrections } = validateAndCorrectDualTokens(rawDual as any);

  await Promise.all([
    prisma.brandingConfig.upsert({
      where: { scope: "organization" },
      update: { tokens: corrected as unknown as Prisma.InputJsonValue },
      create: { scope: "organization", tokens: corrected as unknown as Prisma.InputJsonValue },
    }),
    prisma.organization.updateMany({
      data: { name: companyName, logoUrl },
    }),
  ]);

  revalidateBrandingSurfaces();
  return { corrections };
}

export async function deleteThemePreset(formData: FormData): Promise<void> {
  const id = readString(formData.get("id"));
  if (!id) return;

  await prisma.brandingConfig.delete({
    where: { id },
  }).catch(() => undefined);

  revalidateBrandingSurfaces();
}

export type BrandImportResult = {
  ok: true;
  companyName: string | null;
  logoUrl: string | null;       // best logo for dark theme (white/light variant)
  logoUrlLight: string | null;  // best logo for light theme (dark variant)
  accentColor: string | null;
} | {
  ok: false;
  error: string;
};

/** Classify a logo URL as dark-bg-friendly (white logo) or light-bg-friendly (dark logo). */
function classifyLogoVariant(url: string): "dark-bg" | "light-bg" | "unknown" {
  const lower = url.toLowerCase();
  if (/[\-_/](white|light|reversed|dark-bg|ondark|on-dark)[\-_./]/i.test(lower)) return "dark-bg";
  if (/[\-_/](dark|black|light-bg|onlight|on-light)[\-_./]/i.test(lower)) return "light-bg";
  return "unknown";
}

/**
 * Fetch a public URL and extract brand assets (logo, colors, company name).
 * Called directly from the branding wizard — NOT gated by agent external access toggle.
 */
export async function importBrandFromUrl(url: string): Promise<BrandImportResult> {
  try {
    const evidence = await fetchPublicWebsiteEvidence(url);
    const analysis: BrandingAnalysisResult = analyzePublicWebsiteBranding(evidence);

    // Classify all logo candidates into dark-bg and light-bg variants
    let logoForDarkBg: string | null = null;
    let logoForLightBg: string | null = null;

    for (const candidate of evidence.logoCandidates) {
      const variant = classifyLogoVariant(candidate);
      if (variant === "dark-bg" && !logoForDarkBg) logoForDarkBg = candidate;
      if (variant === "light-bg" && !logoForLightBg) logoForLightBg = candidate;
    }

    // If no classified variants, use the top candidate (already sorted by preference)
    // as the dark-bg logo (platform default) and try to find an alternative for light
    if (!logoForDarkBg && !logoForLightBg) {
      logoForDarkBg = analysis.logoUrl;
    } else if (!logoForDarkBg) {
      // Only found a light-bg variant — also use it as fallback for dark-bg
      logoForDarkBg = logoForLightBg;
    }

    return {
      ok: true,
      companyName: analysis.companyName,
      logoUrl: logoForDarkBg,
      logoUrlLight: logoForLightBg,
      accentColor: analysis.paletteAccent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to analyze URL";
    return { ok: false, error: message };
  }
}

export async function saveSimpleBrand(formData: FormData): Promise<{ corrections: Correction[] }> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const logoUrlLight = readString(formData.get("logoUrlLight")) || null;
  const accent = readString(formData.get("accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("fontFamily")) || "Inter, system-ui, sans-serif";

  const rawTokens = deriveThemeTokens(accent, { fontFamily });
  const { corrected, corrections } = validateAndCorrectDualTokens(rawTokens);

  await Promise.all([
    prisma.brandingConfig.upsert({
      where: { scope: "organization" },
      update: { logoUrlLight, tokens: corrected as unknown as Prisma.InputJsonValue },
      create: { scope: "organization", logoUrlLight, tokens: corrected as unknown as Prisma.InputJsonValue },
    }),
    prisma.organization.updateMany({
      data: { name: companyName, logoUrl },
    }),
  ]);

  revalidateBrandingSurfaces();
  return { corrections };
}
