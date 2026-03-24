"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { CreateAssetInput, DisposeAssetInput } from "@/lib/asset-validation";

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")) {
    throw new Error("Unauthorized");
  }
  return user.id;
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

  const assetId = `FA-${nanoid(8)}`;

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

// ─── runMonthlyDepreciation ───────────────────────────────────────────────────

export async function runMonthlyDepreciation() {
  await requireManageFinance();

  const assets = await prisma.fixedAsset.findMany({ where: { status: "active" } });
  const updates: Promise<unknown>[] = [];

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
  return { processed: updates.length };
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
