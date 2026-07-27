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

/** Test seam — clear between cases. */
export function resetValidatedSiteAddressCacheForTests(): void {
  candidateCache.clear();
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
      // Nominatim requires a descriptive User-Agent.
      "User-Agent": "OpenDigitalProductFactory/site-address-validation (ops@local)",
    },
    // Avoid hanging server actions forever when the free endpoint is slow.
    signal: AbortSignal.timeout(8_000),
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
  options?: { fetchImpl?: FetchLike },
): Promise<ValidatedSiteAddress[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const fetchImpl = options?.fetchImpl ?? fetch;
  const results = await searchNominatim(trimmed, fetchImpl);
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
