// GET  /api/v1/finance/exchange-rates — current stored rates (most recent per pair)
// POST /api/v1/finance/exchange-rates — fetch live ECB reference rates and store them

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { storeExchangeRates } from "@/lib/actions/currency";
import { fetchEcbReferenceRates, type FxRate } from "@/lib/finance/ecb-rates";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

// Static cross-rates used ONLY when the live ECB fetch fails. Stored with
// source="fallback-static" and surfaced as a warning so a degraded fetch is
// never mistaken for live data.
const ECB_FALLBACK_RATES: FxRate[] = [
  { base: "GBP", target: "USD", rate: 1.27 },
  { base: "GBP", target: "EUR", rate: 1.17 },
  { base: "EUR", target: "GBP", rate: 0.855 },
  { base: "EUR", target: "USD", rate: 1.09 },
  { base: "USD", target: "GBP", rate: 0.787 },
  { base: "USD", target: "EUR", rate: 0.917 },
];

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    // Return the most recent rate for each base/target pair
    const rates = await prisma.exchangeRate.findMany({
      orderBy: { fetchedAt: "desc" },
      take: 100,
    });

    // Deduplicate: keep most recent per pair
    const seen = new Set<string>();
    const deduplicated = rates.filter((r) => {
      const key = `${r.baseCurrency}/${r.targetCurrency}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return apiSuccess(deduplicated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    let rates: FxRate[];
    let source: string;
    let warning: string | null = null;

    try {
      rates = await fetchEcbReferenceRates();
      source = "ecb-live";
    } catch (fetchError) {
      const detail = fetchError instanceof Error ? fetchError.message : "unknown error";
      rates = ECB_FALLBACK_RATES;
      source = "fallback-static";
      warning = `Live ECB fetch failed (${detail}); stored static fallback rates`;
    }

    await storeExchangeRates(rates, source);
    const stored = await prisma.exchangeRate.count();

    return apiSuccess(
      {
        message:
          source === "ecb-live"
            ? "Exchange rates updated from the ECB daily reference feed"
            : "Live FX feed unavailable; stored static fallback rates",
        source,
        ratesStored: rates.length,
        totalStored: stored,
        ...(warning ? { warning } : {}),
      },
      201,
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
