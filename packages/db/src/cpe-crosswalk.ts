// CPE 2.3 crosswalk for the CatalogIdentity spine (BI-44B8B1E4, EP-ASSET-INTELLIGENCE).
// CPE (Common Platform Enumeration, cpe:2.3) is the open identity key that both the
// endoflife.date feed (its identifiers[] carry CPE) and NVD CVE lookups join on — the
// vendor→product→version identity analog. This builds a deterministic CPE from a
// CatalogIdentity and (optionally) resolves it to a curated NVD-dictionary name.
//
// The NVD fetch is injectable so the pure build + the upsert are unit-tested from
// fixtures, no network. Air-gapped installs point NVD_API_BASE at a mirror; a free
// NVD_API_KEY raises the rate limit (5→50 req/30s) but is optional.

export type CpeIdentityInput = {
  part?: string | null; // CPE part: a (application) | o (os) | h (hardware)
  manufacturer: string;
  product: string;
  productVersion?: string | null;
  edition?: string | null;
};

const WELL_KNOWN_PARTS = new Set(["a", "o", "h"]);
const NVD_BASE = process.env.NVD_API_BASE ?? "https://services.nvd.nist.gov";
const NVD_KEY = process.env.NVD_API_KEY;
const TIMEOUT_MS = Number(process.env.NVD_TIMEOUT_MS ?? 20000);

/**
 * Normalize a value to a CPE 2.3 well-formed-name component: lowercase, `_` for
 * whitespace, punctuation outside `._-` stripped. Empty → `*` (the CPE "any" marker).
 */
export function cpeToken(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return "*";
  const token = v.replace(/\s+/g, "_").replace(/[^a-z0-9._-]/g, "");
  return token === "" ? "*" : token;
}

/**
 * Build a CPE 2.3 formatted string from a CatalogIdentity. Deterministic — a candidate
 * join key; `fetchNvdCpeNames` refines it to a curated dictionary name where one exists.
 * Unspecified attributes are `*`.
 *   cpe:2.3:part:vendor:product:version:update:edition:lang:sw_edition:target_sw:target_hw:other
 */
export function buildCpe23(identity: CpeIdentityInput): string {
  const part = WELL_KNOWN_PARTS.has(identity.part ?? "") ? identity.part : "a";
  const vendor = cpeToken(identity.manufacturer);
  const product = cpeToken(identity.product);
  const version = identity.productVersion ? cpeToken(identity.productVersion) : "*";
  const edition = identity.edition ? cpeToken(identity.edition) : "*";
  return `cpe:2.3:${part}:${vendor}:${product}:${version}:*:${edition}:*:*:*:*:*`;
}

/**
 * Query the NVD CPE dictionary for names matching a cpe match string. Returns the
 * matching `cpeName` values (curated dictionary names), or [] on any non-OK / error.
 */
export async function fetchNvdCpeNames(
  cpeMatchString: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${NVD_BASE}/rest/json/cpes/2.0?cpeMatchString=${encodeURIComponent(cpeMatchString)}&resultsPerPage=20`;
    const res = await fetcher(url, {
      signal: controller.signal,
      headers: NVD_KEY ? { apiKey: NVD_KEY } : {},
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { products?: Array<{ cpe?: { cpeName?: string } }> };
    return (json.products ?? [])
      .map((p) => p.cpe?.cpeName)
      .filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal prisma surface for the update — keeps this unit-testable with a mock. */
export type CpeUpsertClient = {
  catalogIdentity: {
    update(args: unknown): Promise<unknown>;
  };
};

/**
 * Resolve and persist a CatalogIdentity's `cpe`. Builds the deterministic CPE, then —
 * when a fetcher is supplied — prefers the first curated NVD dictionary name that
 * matches. Returns the CPE written.
 */
export async function resolveCatalogIdentityCpe(
  db: CpeUpsertClient,
  identity: CpeIdentityInput & { id: string },
  fetcher?: typeof fetch,
): Promise<string> {
  const built = buildCpe23(identity);
  let cpe = built;
  if (fetcher) {
    const names = await fetchNvdCpeNames(built, fetcher);
    if (names.length > 0 && typeof names[0] === "string") cpe = names[0];
  }
  await db.catalogIdentity.update({ where: { id: identity.id }, data: { cpe } });
  return cpe;
}
