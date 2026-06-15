"use server";

import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import { seedDefaultDunningSequence } from "@/lib/actions/dunning";
import { resolveInvoiceDefaultTaxRate } from "@/lib/finance/invoice-default-tax";

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
      data: { baseCurrency, autoFetchRates: true, appliedProfileSlug: profileSlug },
    });
  } else {
    await prisma.orgSettings.create({
      data: { baseCurrency, autoFetchRates: true, appliedProfileSlug: profileSlug },
    });
  }

  // Write OrganizationTaxProfile — single-org install, take first org
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (org) {
    await prisma.organizationTaxProfile.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        setupMode: "wizard",
        setupStatus: "draft",
        taxModel: overrides?.vatRegistered ? "vat" : "none",
      },
      update: {
        setupMode: "wizard",
        setupStatus: "draft",
        taxModel: overrides?.vatRegistered ? "vat" : "none",
      },
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

  const isConfigured = !!settings.appliedProfileSlug;

  const dunningSequence = await prisma.dunningSequence.findFirst({
    where: { isDefault: true, isActive: true },
  });

  return {
    isConfigured,
    baseCurrency: settings.baseCurrency,
    dunningActive: dunningSequence !== null,
  };
}

// ─── getInvoiceDefaultTaxRate ─────────────────────────────────────────────────

/**
 * Default line-item tax rate (%) for a new customer invoice or recurring
 * schedule, derived from the org's VAT selection rather than a hardcoded 20.
 * Shared by the invoice and recurring-schedule new-forms so the two cannot
 * drift. See lib/finance/invoice-default-tax.ts for the pure resolution rules.
 */
export async function getInvoiceDefaultTaxRate(): Promise<number> {
  const [taxProfile, settings] = await Promise.all([
    prisma.organizationTaxProfile.findFirst({ select: { taxModel: true } }),
    prisma.orgSettings.findFirst({ select: { appliedProfileSlug: true } }),
  ]);
  const profile = settings?.appliedProfileSlug
    ? getFinancialProfile(settings.appliedProfileSlug)
    : null;
  return resolveInvoiceDefaultTaxRate({
    taxModel: taxProfile?.taxModel ?? null,
    profileVatRegistered: profile?.vatRegistered ?? null,
    profileDefaultTaxRate: profile?.defaultTaxRate ?? null,
  });
}
