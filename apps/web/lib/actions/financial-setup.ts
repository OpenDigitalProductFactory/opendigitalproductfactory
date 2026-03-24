"use server";

import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import { seedDefaultDunningSequence } from "@/lib/actions/dunning";

// ─── applyFinancialProfile ────────────────────────────────────────────────────

export async function applyFinancialProfile(
  profileSlug: string,
  overrides?: { vatRegistered?: boolean; baseCurrency?: string },
): Promise<{ applied: true; profileName: string }> {
  const profile = getFinancialProfile(profileSlug);
  if (!profile) {
    throw new Error(`Financial profile not found: ${profileSlug}`);
  }

  const baseCurrency = overrides?.baseCurrency ?? profile.defaultCurrency;

  // Upsert OrgSettings
  const existing = await prisma.orgSettings.findFirst();
  if (existing) {
    await prisma.orgSettings.update({
      where: { id: existing.id },
      data: { baseCurrency, autoFetchRates: true },
    });
  } else {
    await prisma.orgSettings.create({
      data: { baseCurrency, autoFetchRates: true },
    });
  }

  // Seed dunning sequence if the profile enables it
  if (profile.dunningEnabled) {
    await seedDefaultDunningSequence();
  }

  return { applied: true, profileName: profile.displayName };
}

// ─── getFinancialSetupStatus ──────────────────────────────────────────────────

export async function getFinancialSetupStatus(): Promise<{
  isConfigured: boolean;
  baseCurrency: string;
  dunningActive: boolean;
}> {
  const settings = await prisma.orgSettings.findFirst();
  if (!settings) {
    return { isConfigured: false, baseCurrency: "USD", dunningActive: false };
  }

  const isConfigured = settings.updatedAt > settings.createdAt;

  const dunningSequence = await prisma.dunningSequence.findFirst({
    where: { isDefault: true, isActive: true },
  });

  return {
    isConfigured,
    baseCurrency: settings.baseCurrency,
    dunningActive: dunningSequence !== null,
  };
}
