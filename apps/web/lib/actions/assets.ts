"use server";

import { newId } from "@/lib/shared/new-id";
import { prisma } from "@dpf/db";
import { correlateDiscoveryToAssets } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import type { CreateAssetInput, DisposeAssetInput } from "@/lib/asset-validation";
import { periodKeyOf } from "@/lib/finance/ledger";
import { postDepreciationJournal } from "@/lib/finance/ledger-service";

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  return (await requireCapability("manage_finance")).userId;
}

// ─── calculateDepreciation ─────────────────────────────────────────────────────

export type DepreciationEntry = {
  month: number;
  openingValue: number;
  depreciation: number;
  closingValue: number;
};

export type DepreciationSchedule = {
  monthlySchedule: DepreciationEntry[];
  totalDepreciation: number;
};

export async function calculateDepreciation(
  purchaseCost: number,
  residualValue: number,
  usefulLifeMonths: number,
  method: string,
  monthsElapsed?: number,
): Promise<DepreciationSchedule> {
  const months = monthsElapsed ?? usefulLifeMonths;
  const schedule: DepreciationEntry[] = [];

  if (method === "reducing_balance") {
    // annualRate = 1 - (residualValue / purchaseCost) ^ (1 / (usefulLifeMonths / 12))
    // Guard against edge cases where residualValue is 0 — floor at a tiny positive value
    const effectiveResidual = residualValue > 0 ? residualValue : purchaseCost * 0.001;
    const yearsLife = usefulLifeMonths / 12;
    const annualRate = 1 - Math.pow(effectiveResidual / purchaseCost, 1 / yearsLife);
    const monthlyRate = annualRate / 12;

    let openingValue = purchaseCost;
    for (let m = 1; m <= months; m++) {
      let depreciation = openingValue * monthlyRate;
      let closingValue = openingValue - depreciation;
      // Floor at residualValue
      if (closingValue < residualValue) {
        depreciation = openingValue - residualValue;
        closingValue = residualValue;
      }
      schedule.push({ month: m, openingValue, depreciation, closingValue });
      openingValue = closingValue;
      if (openingValue <= residualValue) break;
    }
  } else {
    // Straight line
    const monthlyDepreciation = (purchaseCost - residualValue) / usefulLifeMonths;
    let openingValue = purchaseCost;
    for (let m = 1; m <= months; m++) {
      let depreciation = monthlyDepreciation;
      let closingValue = openingValue - depreciation;
      // Last month: adjust to hit residualValue exactly
      if (m === months || closingValue < residualValue) {
        depreciation = openingValue - residualValue;
        closingValue = residualValue;
      }
      schedule.push({ month: m, openingValue, depreciation, closingValue });
      openingValue = closingValue;
    }
  }

  const totalDepreciation = schedule.reduce((sum, e) => sum + e.depreciation, 0);
  return { monthlySchedule: schedule, totalDepreciation };
}

// ─── createAsset ──────────────────────────────────────────────────────────────

export async function createAsset(input: CreateAssetInput) {
  await requireManageFinance();

  const assetId = `FA-${newId(8)}`;

  const asset = await prisma.fixedAsset.create({
    data: {
      assetId,
      name: input.name,
      category: input.category,
      purchaseDate: new Date(input.purchaseDate),
      purchaseCost: input.purchaseCost,
      currency: input.currency ?? "USD",
      depreciationMethod: input.depreciationMethod ?? "straight_line",
      usefulLifeMonths: input.usefulLifeMonths,
      residualValue: input.residualValue ?? 0,
      currentBookValue: input.purchaseCost,
      accumulatedDepreciation: 0,
      status: "active",
      location: input.location ?? null,
      serialNumber: input.serialNumber ?? null,
      notes: input.notes ?? null,
    },
  });

  return asset;
}

// ─── getAsset ─────────────────────────────────────────────────────────────────

export async function getAsset(id: string) {
  const asset = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!asset) return null;

  const schedule = calculateDepreciation(
    Number(asset.purchaseCost),
    Number(asset.residualValue),
    asset.usefulLifeMonths,
    asset.depreciationMethod,
  );

  return { ...asset, depreciationSchedule: schedule };
}

// ─── listAssets ───────────────────────────────────────────────────────────────

export async function listAssets(filters?: { status?: string; category?: string }) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.category) where.category = filters.category;

  return prisma.fixedAsset.findMany({ where, orderBy: { name: "asc" } });
}

// ─── getAssetRegisterReconciliation (BI-1093AF1C, HAM D2) ───────────────────────

export type AssetRegisterReconciliation = {
  capitalizedAndDiscovered: number;
  capitalizedNotDiscovered: number;
  discoveredNotCapitalized: number;
  serialBearingDevices: number;
};

/**
 * Reconcile the finance asset register against the discovered estate by serial (read-model,
 * no authority move / no persistence — spec §7). Answers: which capitalized assets are live
 * on the network, which are on the books but unseen, and which serial-bearing discovered
 * devices aren't capitalized. Scoped to the org's OWN estate (`organization:internal`) —
 * FixedAsset is the org's finance register, not customer equipment.
 */
export async function getAssetRegisterReconciliation(): Promise<AssetRegisterReconciliation> {
  await requireManageFinance();

  const [assets, devices] = await Promise.all([
    prisma.fixedAsset.findMany({
      where: { status: "active" },
      select: { id: true, serialNumber: true },
    }),
    prisma.inventoryEntity.findMany({
      where: { scopeKey: "organization:internal", status: { not: "stale" } },
      select: { id: true, properties: true },
    }),
  ]);

  const result = correlateDiscoveryToAssets(
    devices.map((d) => ({ id: d.id, properties: d.properties as Record<string, unknown> | null })),
    assets.map((a) => ({ id: a.id, serialNumber: a.serialNumber })),
  );

  return {
    capitalizedAndDiscovered: result.capitalizedAndDiscovered,
    capitalizedNotDiscovered: result.capitalizedNotDiscovered,
    discoveredNotCapitalized: result.discoveredNotCapitalized,
    serialBearingDevices: result.serialBearingDevices,
  };
}

// ─── runMonthlyDepreciation ───────────────────────────────────────────────────

export async function runMonthlyDepreciation() {
  await requireManageFinance();

  const assets = await prisma.fixedAsset.findMany({ where: { status: "active" } });
  const updates: Promise<unknown>[] = [];
  let totalCharge = 0;

  for (const asset of assets) {
    const purchaseCost = Number(asset.purchaseCost);
    const residualValue = Number(asset.residualValue);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
    const currentBookValue = Number(asset.currentBookValue);

    if (currentBookValue <= residualValue) continue;

    let monthlyAmount: number;
    if (asset.depreciationMethod === "reducing_balance") {
      const effectiveResidual = residualValue > 0 ? residualValue : purchaseCost * 0.001;
      const yearsLife = asset.usefulLifeMonths / 12;
      const annualRate = 1 - Math.pow(effectiveResidual / purchaseCost, 1 / yearsLife);
      const monthlyRate = annualRate / 12;
      monthlyAmount = currentBookValue * monthlyRate;
    } else {
      monthlyAmount = (purchaseCost - residualValue) / asset.usefulLifeMonths;
    }

    const newBookValue = Math.max(currentBookValue - monthlyAmount, residualValue);
    const actualDepreciation = currentBookValue - newBookValue;
    const newAccumulated = accumulatedDepreciation + actualDepreciation;
    totalCharge += actualDepreciation;

    updates.push(
      prisma.fixedAsset.update({
        where: { id: asset.id },
        data: {
          currentBookValue: newBookValue,
          accumulatedDepreciation: newAccumulated,
        },
      }),
    );
  }

  await Promise.all(updates);

  // Record the period's depreciation on the general ledger (Dr Depreciation /
  // Cr Accumulated Depreciation). Best-effort: a ledger hiccup must not fail the
  // asset run, and the post is idempotent per period so a retry is safe.
  let glPosted = false;
  if (totalCharge > 0) {
    try {
      const result = await postDepreciationJournal(periodKeyOf(new Date()), totalCharge);
      glPosted = result.posted;
    } catch (err) {
      console.error("[ledger] failed to post depreciation to the general ledger:", err);
    }
  }

  return {
    processed: updates.length,
    totalCharge: Math.round(totalCharge * 100) / 100,
    glPosted,
  };
}

// ─── disposeAsset ─────────────────────────────────────────────────────────────

export async function disposeAsset(id: string, input: DisposeAssetInput) {
  await requireManageFinance();

  const asset = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!asset) throw new Error("Asset not found");

  const currentBookValue = Number(asset.currentBookValue);
  const gainLoss = input.disposalAmount - currentBookValue;

  await prisma.fixedAsset.update({
    where: { id },
    data: {
      status: "disposed",
      disposedAt: input.disposedAt ? new Date(input.disposedAt) : new Date(),
      disposalAmount: input.disposalAmount,
    },
  });

  return { gainLoss };
}
