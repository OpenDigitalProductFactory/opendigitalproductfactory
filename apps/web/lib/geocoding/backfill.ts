// One pass of the opt-in geocoding backfill (BI-560128FB, AC-CMAP-PROVIDER-2).
// Fills only addresses still missing coordinates, through the provider the
// administrator chose, at that provider's pace, asking once per distinct
// address. The write is conditional on the coordinate still being empty, so a
// lookup pick or a manual pin made meanwhile is never overwritten.

import type { GeocodeInput, GeocodingProvider } from "./providers";

/** Addresses handled per pass; the caller repeats passes until none remain. */
export const BACKFILL_PASS_SIZE = 100;

type AddressRow = {
  id: string;
  addressLine1: string;
  postalCode: string;
  city: { name: string; region: { name: string; code: string | null; country: { iso2: string } } };
};

export interface BackfillDb {
  address: {
    findMany(args: unknown): Promise<AddressRow[]>;
    count(args: unknown): Promise<number>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export type BackfillPassResult = {
  ran: boolean;
  placed: number;
  notFound: number;
  remaining: number | null;
  /** Last address id handled; pass it as `afterId` to continue the sweep. */
  lastId?: string;
  /** True when this pass reached the end of the sweep. */
  exhausted?: boolean;
};

/** Addresses of live customer sites that have no coordinates yet. */
const MISSING_WHERE = {
  latitude: null,
  status: "active",
  customerSites: { some: { mergedIntoId: null } },
};

function normalized(input: GeocodeInput): string {
  return [input.line1, input.city, input.region, input.postalCode, input.countryCode]
    .join("|")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export async function runGeocodingBackfillPass(
  db: BackfillDb,
  provider: GeocodingProvider,
  deps: {
    fetchImpl: Parameters<GeocodingProvider["geocode"]>[1]["fetchImpl"];
    sleep: (ms: number) => Promise<void>;
    now?: Date;
    /** Continue after this id, so addresses no provider could find are not re-asked within a run. */
    afterId?: string;
  },
): Promise<BackfillPassResult> {
  if (!provider.enabled) return { ran: false, placed: 0, notFound: 0, remaining: null };
  const now = deps.now ?? new Date();
  const rows = await db.address.findMany({
    where: deps.afterId ? { ...MISSING_WHERE, id: { gt: deps.afterId } } : MISSING_WHERE,
    select: {
      id: true,
      addressLine1: true,
      postalCode: true,
      city: { select: { name: true, region: { select: { name: true, code: true, country: { select: { iso2: true } } } } } },
    },
    take: BACKFILL_PASS_SIZE,
    orderBy: { id: "asc" },
  });

  // One request per distinct address text; every address sharing it gets the answer.
  const byText = new Map<string, { input: GeocodeInput; ids: string[] }>();
  for (const row of rows) {
    const input: GeocodeInput = {
      key: row.id,
      line1: row.addressLine1,
      city: row.city.name,
      region: row.city.region.code ?? row.city.region.name,
      postalCode: row.postalCode,
      countryCode: row.city.region.country.iso2,
    };
    const text = normalized(input);
    const entry = byText.get(text);
    if (entry) entry.ids.push(row.id);
    else byText.set(text, { input, ids: [row.id] });
  }

  const distinct = [...byText.values()];
  let placed = 0;
  let notFound = 0;
  for (let start = 0; start < distinct.length; start += Math.max(1, provider.batchSize)) {
    if (start > 0) await deps.sleep(provider.minIntervalMs);
    const batch = distinct.slice(start, start + Math.max(1, provider.batchSize));
    const results = await provider.geocode(batch.map((entry) => entry.input), { fetchImpl: deps.fetchImpl });
    const byKey = new Map(results.map((result) => [result.key, result]));
    for (const entry of batch) {
      const result = byKey.get(entry.input.key);
      for (const id of entry.ids) {
        if (result?.status !== "found") {
          notFound += 1;
          continue;
        }
        const written = await db.address.updateMany({
          where: { id, latitude: null },
          data: { latitude: result.latitude, longitude: result.longitude, validatedAt: now, validationSource: provider.id },
        });
        placed += written.count;
      }
    }
  }
  const remaining = await db.address.count({ where: MISSING_WHERE });
  return {
    ran: true,
    placed,
    notFound,
    remaining,
    lastId: rows.at(-1)?.id ?? deps.afterId,
    exhausted: rows.length < BACKFILL_PASS_SIZE,
  };
}
