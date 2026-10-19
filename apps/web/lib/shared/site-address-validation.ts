/**
 * Validated site-address lookup for customer sites (EP-SITE-7C4D2B).
 *
 * Search caches candidates so resolve can rehydrate the same selection on
 * create/update without a second provider call. Free Nominatim is the
 * default path when commercial Smarty/Mapbox keys are not wired yet
 * (see address-validation-provider-guidance).
 */

export type ValidatedSiteAddress = {
  providerRef: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  regionCode: string | null;
  country: string;
  countryCode: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  precision: string | null;
  validationSource: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Process-local cache of search hits, keyed by providerRef. */
const candidateCache = new Map<string, ValidatedSiteAddress>();

// OSMF Nominatim usage policy (BI-3099EACD,
// https://operations.osmfoundation.org/policies/nominatim/): at most one request
// per second for the whole application, results cached, an identifying
// User-Agent, and no search-as-you-type. Breaching it gets the install's IP
// blocked, which breaks address validation for every organization on it.
const NOMINATIM_MIN_INTERVAL_MS = 1000;
const QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUERY_CACHE_MAX_ENTRIES = 500;
const NOMINATIM_USER_AGENT =
  "OpenDigitalProductFactory/site-address-validation (+https://github.com/OpenDigitalProductFactory/opendigitalproductfactory)";

/** Process-local cache of whole searches, keyed by the normalized query. */
const queryCache = new Map<string, { at: number; results: ValidatedSiteAddress[] }>();
let nextNominatimSlotAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

/** Test seam — clear between cases. */
export function resetValidatedSiteAddressCacheForTests(): void {
  candidateCache.clear();
  queryCache.clear();
  nextNominatimSlotAt = 0;
  nominatimQueue = Promise.resolve();
}

type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

/** Wait for this caller's turn: calls leave in order, one second apart. */
function takeNominatimSlot({ now, sleep }: Clock): Promise<void> {
  const turn = nominatimQueue.then(async () => {
    const wait = nextNominatimSlotAt - now();
    if (wait > 0) await sleep(wait);
    nextNominatimSlotAt = now() + NOMINATIM_MIN_INTERVAL_MS;
  });
  nominatimQueue = turn.catch(() => {});
  return turn;
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function rememberQuery(key: string, results: ValidatedSiteAddress[], at: number): void {
  queryCache.delete(key);
  queryCache.set(key, { at, results });
  while (queryCache.size > QUERY_CACHE_MAX_ENTRIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest === undefined) break;
    queryCache.delete(oldest);
  }
}

/** Test seam — seed a candidate without calling a provider. */
export function rememberValidatedSiteAddressForTests(
  address: ValidatedSiteAddress,
): void {
  candidateCache.set(address.providerRef, address);
}

type NominatimItem = {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    state_code?: string;
    "ISO3166-2-lvl4"?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
};

function line1FromNominatim(address: NonNullable<NominatimItem["address"]>): string {
  const number = address.house_number?.trim() ?? "";
  const road =
    address.road?.trim() ||
    address.pedestrian?.trim() ||
    address.neighbourhood?.trim() ||
    address.suburb?.trim() ||
    "";
  if (number && road) return `${number} ${road}`;
  if (road) return road;
  if (number) return number;
  return "";
}

function cityFromNominatim(address: NonNullable<NominatimItem["address"]>): string {
  return (
    address.city?.trim() ||
    address.town?.trim() ||
    address.village?.trim() ||
    address.hamlet?.trim() ||
    address.county?.trim() ||
    ""
  );
}

function regionCodeFromNominatim(
  address: NonNullable<NominatimItem["address"]>,
): string | null {
  if (address.state_code?.trim()) return address.state_code.trim().toUpperCase();
  const iso = address["ISO3166-2-lvl4"]?.trim();
  if (iso && iso.includes("-")) {
    return iso.split("-").pop()?.toUpperCase() ?? null;
  }
  return null;
}

function mapNominatimItem(item: NominatimItem): ValidatedSiteAddress | null {
  const address = item.address;
  if (!address) return null;

  const addressLine1 = line1FromNominatim(address);
  const city = cityFromNominatim(address);
  const region = address.state?.trim() || "";
  const country = address.country?.trim() || "";
  const countryCode = (address.country_code ?? "").trim().toUpperCase();
  const postalCode = address.postcode?.trim() || "";

  if (!addressLine1 || !city || !region || !country || !countryCode || !postalCode) {
    return null;
  }

  const placeId = item.place_id != null ? String(item.place_id) : null;
  if (!placeId) return null;

  const lat = item.lat != null ? Number(item.lat) : null;
  const lon = item.lon != null ? Number(item.lon) : null;

  return {
    providerRef: `nominatim:${placeId}`,
    label:
      item.display_name?.trim() ||
      [addressLine1, city, region, postalCode, country].filter(Boolean).join(", "),
    addressLine1,
    addressLine2: null,
    city,
    region,
    regionCode: regionCodeFromNominatim(address),
    country,
    countryCode,
    postalCode,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    precision: "street",
    validationSource: "nominatim",
  };
}

async function searchNominatim(
  query: string,
  fetchImpl: FetchLike,
): Promise<ValidatedSiteAddress[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Address lookup failed (${response.status}). Try again or configure a commercial provider.`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) return [];

  const mapped: ValidatedSiteAddress[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const item = mapNominatimItem(raw as NominatimItem);
    if (item) mapped.push(item);
  }
  return mapped;
}

export async function searchValidatedSiteAddresses(
  query: string,
  options?: { fetchImpl?: FetchLike } & Partial<Clock>,
): Promise<ValidatedSiteAddress[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const clock: Clock = {
    now: options?.now ?? Date.now,
    sleep: options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const key = normalizeQuery(trimmed);
  const hit = queryCache.get(key);
  if (hit && clock.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.results;

  await takeNominatimSlot(clock);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const results = await searchNominatim(trimmed, fetchImpl);
  rememberQuery(key, results, clock.now());
  for (const result of results) {
    candidateCache.set(result.providerRef, result);
  }
  return results;
}

export async function resolveValidatedSiteAddress(
  providerRef: string,
): Promise<ValidatedSiteAddress> {
  const ref = providerRef.trim();
  if (!ref) {
    throw new Error("A validated address selection is required");
  }

  const cached = candidateCache.get(ref);
  if (cached) return cached;

  throw new Error(
    "That address selection expired or is unknown. Search again and pick a result from the list.",
  );
}
