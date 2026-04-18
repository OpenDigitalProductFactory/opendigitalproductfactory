"use server";

import { prisma } from "@dpf/db";
import { isBrandDesignSystem, type BrandDesignSystem } from "@/lib/brand/types";
import { designSystemToThemeTokens } from "@/lib/brand/apply";

export type ApplyResult =
  | { success: true }
  | { success: false; error: string };

function deepMerge<T>(target: T, source: Partial<T>): T {
  if (typeof target !== "object" || target === null) return (source as T) ?? target;
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof result[key] === "object"
      && result[key] !== null
      && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Apply user-approved overrides to the extracted BrandDesignSystem and
 * refresh BrandingConfig.tokens. The raw extracted system stays intact
 * on Organization.designSystem; overrides accumulate in
 * designSystem.overrides so a re-extraction can merge them back in.
 */
export async function applyBrandDesignSystem(
  organizationId: string,
  overrides?: Partial<Omit<BrandDesignSystem, "version" | "overrides">>,
): Promise<ApplyResult> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { designSystem: true },
  });

  if (!org?.designSystem || !isBrandDesignSystem(org.designSystem)) {
    return { success: false, error: "No extracted brand design system to apply." };
  }

  const system = org.designSystem;
  const nextOverrides = overrides
    ? deepMerge(system.overrides ?? {}, overrides)
    : system.overrides ?? {};

  // Persist overrides on the substrate so re-extraction can fold them back in.
  const merged = deepMerge(system, (overrides ?? {}) as Partial<BrandDesignSystem>);
  const updatedSystem: BrandDesignSystem = {
    ...merged,
    version: "1.0.0",
    overrides: nextOverrides,
  };

  await prisma.organization.update({
    where: { id: organizationId },
    data: { designSystem: JSON.parse(JSON.stringify(updatedSystem)) },
  });

  try {
    const tokens = designSystemToThemeTokens(updatedSystem);
    await prisma.brandingConfig.upsert({
      where: { scope: `organization:${organizationId}` },
      update: {
        tokens: JSON.parse(JSON.stringify(tokens)),
        organizationId,
      },
      create: {
        scope: `organization:${organizationId}`,
        label: updatedSystem.identity.name || "Organization",
        tokens: JSON.parse(JSON.stringify(tokens)),
        organizationId,
      },
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to refresh theme tokens.",
    };
  }

  return { success: true };
}
