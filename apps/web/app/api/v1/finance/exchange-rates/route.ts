// GET /api/v1/finance/exchange-rates — current exchange rates (recent records)
// POST /api/v1/finance/exchange-rates — trigger rate fetch/store (ECB fallback)

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { storeExchangeRates } from "@/lib/actions/currency";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

// ECB fallback rates (GBP base) — used when live fetch is unavailable
const ECB_RATES: Array<{ base: string; target: string; rate: number }> = [
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

    // Store ECB reference rates (production would fetch live from ECB XML feed)
    await storeExchangeRates(ECB_RATES);

    const stored = await prisma.exchangeRate.count();

    return apiSuccess({ message: "Exchange rates updated", totalStored: stored }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
