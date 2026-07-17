// SBOM → CatalogIdentity bridge (BI-19FD07F9, EP-ASSET-INTELLIGENCE). An SBOM
// enumerates the many software components inside one package; this normalizes each
// BomComponent (via its Package URL / PURL) into a canonical CatalogIdentity, so one
// SBOM ingest enriches dozens of identities the lifecycle/CVE feeds can then decorate.
//
// Sharing split (spec §4.7/§4.8): the BomComponent — a generic component identity,
// usually public OSS — becomes shareable catalog knowledge; the BomComponentOccurrence
// (which proprietary product contains it) is composition IP and is NOT touched here.

export type BomComponentInput = {
  name: string;
  version?: string | null;
  packageUrl?: string | null;
  supplierName?: string | null;
  ecosystem?: string | null;
};

export type ParsedPurl = {
  type: string;
  namespace: string | null;
  name: string;
  version: string | null;
};

/**
 * Parse a Package URL (`pkg:type/namespace/name@version?qualifiers#subpath`). The
 * version `@` is taken after the last path segment, so npm scopes (`@babel`) are not
 * mistaken for a version. Returns null for anything that is not a `pkg:` URL.
 */
export function parsePurl(purl: string | null | undefined): ParsedPurl | null {
  if (!purl || !purl.startsWith("pkg:")) return null;
  const clean = purl.slice(4).split(/[?#]/)[0] ?? "";
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash < 0) return null;
  const head = clean.slice(0, lastSlash);
  const tail = clean.slice(lastSlash + 1);
  const atIdx = tail.indexOf("@");
  const name = atIdx >= 0 ? tail.slice(0, atIdx) : tail;
  const version = atIdx >= 0 ? tail.slice(atIdx + 1) : null;
  const headParts = head.split("/");
  const type = headParts[0] ?? "";
  const namespace = headParts.slice(1).join("/") || null;
  if (type === "" || name === "") return null;
  return { type, namespace, name, version: version || null };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export type DerivedComponentIdentity = {
  identityKey: string;
  part: string;
  manufacturer: string;
  product: string;
  productVersion: string | null;
};

/**
 * Derive a canonical CatalogIdentity from a BomComponent. Prefers the PURL
 * (namespace→manufacturer, name→product, version); falls back to supplierName /
 * ecosystem / component name. SBOM components are version-specific, so the version is
 * part of the identityKey. Returns null when there is no resolvable product name.
 */
export function bomComponentToCatalogIdentity(component: BomComponentInput): DerivedComponentIdentity | null {
  const purl = parsePurl(component.packageUrl);
  const product = (purl?.name ?? component.name ?? "").trim();
  if (product === "") return null;
  const manufacturer =
    (purl?.namespace ?? component.supplierName ?? purl?.type ?? component.ecosystem ?? "unknown").trim() || "unknown";
  const version = (purl?.version ?? component.version ?? null) || null;
  const identityKey = `a:${slug(manufacturer)}:${slug(product)}${version ? `:${slug(version)}` : ""}`;
  return { identityKey, part: "a", manufacturer, product, productVersion: version };
}

/** Minimal prisma surface for the upsert — keeps this unit-testable with a mock. */
export type SbomBridgeClient = {
  catalogIdentity: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
};

/** Upsert a canonical CatalogIdentity for one BomComponent. Returns its identityKey, or null. */
export async function upsertIdentityForComponent(
  db: SbomBridgeClient,
  component: BomComponentInput,
): Promise<string | null> {
  const identity = bomComponentToCatalogIdentity(component);
  if (identity === null) return null;
  const fields = {
    part: identity.part,
    manufacturer: identity.manufacturer,
    product: identity.product,
    productVersion: identity.productVersion,
    source: "sbom",
  };
  await db.catalogIdentity.upsert({
    where: { identityKey: identity.identityKey },
    update: fields,
    create: { identityKey: identity.identityKey, ...fields },
    select: { id: true },
  });
  return identity.identityKey;
}

/** Bridge a set of BomComponents into the catalog; returns how many identities were upserted. */
export async function upsertIdentitiesForComponents(
  db: SbomBridgeClient,
  components: BomComponentInput[],
): Promise<number> {
  let upserted = 0;
  for (const component of components) {
    if ((await upsertIdentityForComponent(db, component)) !== null) upserted += 1;
  }
  return upserted;
}
