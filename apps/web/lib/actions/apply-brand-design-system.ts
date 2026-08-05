"use server";

import { prisma } from "@dpf/db";
import { isBrandDesignSystem, type BrandDesignSystem } from "@/lib/brand/types";
import { designSystemToThemeTokens } from "@/lib/brand/apply";
import { requireCapability } from "@/lib/actions/shared/guards";

export type ApplyResult =
  | { success: true }
  | { success: false; error: string };

function deepMerge<T>(target: T, source: Partial<T>): T {
  if (typeof target !== "object" || target === null) return (source as T) ?? target;
  // CodeQL #195/#196 (js/remote-property-injection, CWE-1321):
  // The result object is created with Object.create(null) so it has no
  // prototype — `result["__proto__"] = x` becomes a literal own-property
  // write instead of triggering Object.prototype's __proto__ setter.
  // The function returns a plain `T`, which still satisfies any consumer
  // doing structural property access. This is the CodeQL-recognised
  // structural mitigation for js/remote-property-injection (previous
  // inline `if (key === "__proto__" || ...)` OR-chain guard was correct
  // at runtime but the analyser didn't recognise it as a barrier).
  const result: Record<string, unknown> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    target as Record<string, unknown>,
  );
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
  // Authority check FIRST — this writes the organization's visual identity across the
  // whole portal (BI-6197FFE3). `manage_branding` is the capability the MCP brand tools
  // already require (lib/mcp/packs/public-web-design-pack.ts), so this closes a
  // per-transport gap rather than inventing a new rule: the coworker calling the tool
  // was checked, a direct POST to this action was not.
  //
  // The /admin layout enforces view_admin, but a layout guard does NOT protect a server
  // action — there is no middleware in apps/web, so the body runs before any
  // render-time redirect. manage_branding and view_admin are both ["HR-000"], so no
  // user who can reach the branding page loses the ability to apply.
  //
  // `organizationId` stays caller-supplied: every caller passes the single install org
  // resolved server-side, and with authority now restricted to HR-000 — who can rebrand
  // the install regardless — narrowing it further buys nothing. Revisit if this action
  // is ever exposed to a broader role or a multi-org install.
  //
  // Returned rather than thrown: every other failure here returns ApplyResult, and the
  // sole caller (BrandExtractionSection) checks `result.success` without a try/catch, so
  // throwing would break this module's contract and surface as an unhandled rejection.
  // The refusal is identical either way — nothing below runs.
  try {
    await requireCapability("manage_branding");
  } catch {
    return { success: false, error: "You do not have permission to change branding." };
  }

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
