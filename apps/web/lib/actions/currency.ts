"use server";

import { prisma } from "@dpf/db";

// ─── Hardcoded fallback rates (GBP base) ──────────────────────────────────────

const FALLBACK_RATES: Record<string, Record<string, number>> = {
  GBP: { USD: 1.27, EUR: 1.17, GBP: 1 },
  EUR: { USD: 1.09, GBP: 0.855, EUR: 1 },
  USD: { GBP: 0.787, EUR: 0.917, USD: 1 },
};

// ─── getOrgSettings ───────────────────────────────────────────────────────────

export async function getOrgSettings() {
  const existing = await prisma.orgSettings.findFirst();
  if (existing) return existing;

  return prisma.orgSettings.create({
    data: { baseCurrency: "GBP" },
  });
}

// ─── updateBaseCurrency ───────────────────────────────────────────────────────

export async function updateBaseCurrency(currency: string) {
  const settings = await getOrgSettings();
  return prisma.orgSettings.update({
    where: { id: settings.id },
    data: { baseCurrency: currency },
  });
}

// ─── getExchangeRate ──────────────────────────────────────────────────────────

export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  // Look up latest stored rate
  const stored = await prisma.exchangeRate.findFirst({
    where: { baseCurrency: from, targetCurrency: to },
    orderBy: { fetchedAt: "desc" },
  });
  if (stored) return Number(stored.rate);

  // Try fallback rates
  if (FALLBACK_RATES[from]?.[to] !== undefined) {
    return FALLBACK_RATES[from][to];
  }

  throw new Error(`No exchange rate found for ${from}/${to}`);
}

// ─── convertAmountSync ────────────────────────────────────────────────────────

export async function convertAmountSync(amount: number, rate: number): Promise<number> {
  return amount * rate;
}

// ─── convertAmount ────────────────────────────────────────────────────────────

export async function convertAmount(
  amount: number,
  from: string,
  to: string,
): Promise<{ convertedAmount: number; rateUsed: number }> {
  const rateUsed = await getExchangeRate(from, to);
  const convertedAmount = await convertAmountSync(amount, rateUsed);
  return { convertedAmount, rateUsed };
}

// ─── calculateFxGainLoss ──────────────────────────────────────────────────────

export async function calculateFxGainLoss(invoiceAmountBase: number, paymentAmountBase: number): Promise<number> {
  return paymentAmountBase - invoiceAmountBase;
}

// ─── storeExchangeRates ───────────────────────────────────────────────────────

export async function storeExchangeRates(
  rates: Array<{ base: string; target: string; rate: number }>,
) {
  return prisma.exchangeRate.createMany({
    data: rates.map((r) => ({
      baseCurrency: r.base,
      targetCurrency: r.target,
      rate: r.rate,
    })),
    skipDuplicates: true,
  });
}
