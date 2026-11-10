"use server";

// Customer map actions (BI-560128FB): place a site by hand, choose the
// geocoding provider, and start the opt-in backfill. Every action checks its
// capability before doing anything.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { saveGeocodingConfig, startGeocodingBackfill } from "@/lib/geocoding/backfill.server";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

async function allowed(capability: Parameters<typeof requireCapability>[0]): Promise<boolean> {
  try {
    await requireCapability(capability);
    return true;
  } catch {
    return false;
  }
}

/** Store a hand-placed point on the site's address (AC-CMAP-FIX-2). */
export async function placeCustomerSiteOnMapAction(
  siteId: string,
  latitude: number,
  longitude: number,
): Promise<ActionResult> {
  if (!(await allowed("operate_customer"))) return err("forbidden");
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180
  ) {
    return err("invalid-point");
  }
  const site = await prisma.customerSite.findFirst({
    where: { id: siteId, mergedIntoId: null },
    select: { primaryAddressId: true },
  });
  if (!site) return err("not-found");
  if (!site.primaryAddressId) return err("no-address");
  await prisma.address.update({
    where: { id: site.primaryAddressId },
    data: { latitude, longitude, validatedAt: new Date(), validationSource: "manual-pin" },
  });
  revalidatePath("/customer");
  return ok();
}

export async function saveGeocodingProviderAction(config: unknown): Promise<ActionResult<{ provider: string }>> {
  if (!(await allowed("manage_platform"))) return err("forbidden");
  const saved = await saveGeocodingConfig(config);
  revalidatePath("/customer");
  return ok({ provider: saved.provider });
}

export async function startGeocodingBackfillAction(): Promise<ActionResult> {
  if (!(await allowed("manage_platform"))) return err("forbidden");
  const result = await startGeocodingBackfill();
  if (!result.started) return err(result.reason ?? "not-started");
  revalidatePath("/customer");
  return ok();
}

/**
 * Install the street-map pack the Street maps panel recommends (BI-43BBCC26).
 * The recommendation is recomputed here, so the client names a pack id and
 * never supplies bounds; only a pack recommended for an uncovered region can
 * be installed, one at a time.
 */
export async function installRecommendedMapPackAction(packId: string): Promise<ActionResult> {
  if (!(await allowed("manage_platform"))) return err("forbidden");
  const { loadMapRegionRecommendation } = await import("@/lib/twin/map-region-recommendation.server");
  const { isInstallRunning, readInstallStatus, writeInstallStatus } = await import("@/lib/twin/map-pack-install/status.server");
  const { getLocaleContext } = await import("@/lib/i18n/locale-context.server");
  const { jobs } = await import("@/lib/jobs");

  const recommendation = await loadMapRegionRecommendation();
  const group = recommendation.groups.find((g) => g.suggestedPackId === packId && !g.coveredBy);
  if (!group || !group.suggestedPackId) return err("not-recommended");
  if (isInstallRunning(await readInstallStatus())) return err("already-running");

  const locale = await getLocaleContext();
  await writeInstallStatus({
    state: "planning", packId: group.suggestedPackId, region: group.label,
    chunksDone: 0, chunkCount: 0, totalBytes: 0, error: null,
  });
  await jobs.send({
    name: "map-pack/install.requested",
    data: { packId: group.suggestedPackId, region: group.label, bounds: group.bounds, locale: locale.language },
  });
  revalidatePath("/customer");
  return ok();
}
