"use server";

import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { deriveThemeTokens } from "@/lib/branding-presets";

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
}

export async function saveThemePreset(formData: FormData): Promise<void> {
  const scope = resolvePresetScope(formData);
  const companyName = readString(formData.get("companyName")) || "Custom";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const tokens = buildThemeTokens(formData);

  await prisma.brandingConfig.upsert({
    where: { scope },
    update: {
      companyName,
      logoUrl,
      tokens,
    },
    create: {
      scope,
      companyName,
      logoUrl,
      tokens,
    },
  });

  revalidateBrandingSurfaces();
}

export async function saveActiveThemePreset(formData: FormData): Promise<void> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const tokens = buildThemeTokens(formData);

  await prisma.brandingConfig.upsert({
    where: { scope: "organization" },
    update: {
      companyName,
      logoUrl,
      tokens,
    },
    create: {
      scope: "organization",
      companyName,
      logoUrl,
      tokens,
    },
  });

  revalidateBrandingSurfaces();
}

export async function deleteThemePreset(formData: FormData): Promise<void> {
  const id = readString(formData.get("id"));
  if (!id) return;

  await prisma.brandingConfig.delete({
    where: { id },
  }).catch(() => undefined);

  revalidateBrandingSurfaces();
}

export async function saveSimpleBrand(formData: FormData): Promise<void> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const accent = readString(formData.get("accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("fontFamily")) || "Inter, system-ui, sans-serif";

  const tokens = deriveThemeTokens(accent, { fontFamily });

  await prisma.brandingConfig.upsert({
    where: { scope: "organization" },
    update: { companyName, logoUrl, tokens: tokens as unknown as Prisma.InputJsonValue },
    create: { scope: "organization", companyName, logoUrl, tokens: tokens as unknown as Prisma.InputJsonValue },
  });

  revalidateBrandingSurfaces();
}
