// endoflife.date support-lifecycle feed → CatalogLifecycleMilestone (BI-3A2328D6,
// EP-ASSET-INTELLIGENCE). endoflife.date is an open (MIT) catalog of EOL/EOS dates;
// this maps a product's release lifecycle onto the canonical CatalogIdentity spine
// (#3123), so an enriched asset carries structured support-lifecycle milestones with
// their source + confidence — the "support lifecycle feeds" capability, composing an
// open feed rather than a single-vendor catalog (spec §2, §4.4).
//
// Air-gapped installs can point ENDOFLIFE_BASE_URL at a mirror. The fetcher is
// injectable so the mapping + upsert are unit-tested from fixtures, no network.

/** One release entry from `GET /api/v1/products/{slug}/` (`releases[]`). */
export type EolRelease = {
  name?: string;
  releaseDate?: string | null;
  isEol?: boolean;
  eolFrom?: string | null;
  // end of active (mainstream) support
  isEoas?: boolean;
  eoasFrom?: string | null;
  // end of extended support
  isEoes?: boolean;
  eoesFrom?: string | null;
};

export type EolProduct = {
  name: string;
  releases: EolRelease[];
};

/** A CatalogLifecycleMilestone row to upsert (source is always endoflife.date here). */
export type LifecycleMilestone = {
  milestone: "release" | "mainstream_end" | "extended_support_end" | "eol";
  date: string | null;
};

const SOURCE = "endoflife.date";
const EOL_BASE = process.env.ENDOFLIFE_BASE_URL ?? "https://endoflife.date";
const TIMEOUT_MS = Number(process.env.ENDOFLIFE_TIMEOUT_MS ?? 20000);

/**
 * Map one endoflife.date release onto CatalogLifecycleMilestone rows. Emits only
 * milestones that have a date, so an unknown milestone never overwrites a known one.
 */
export function releaseToMilestones(release: EolRelease): LifecycleMilestone[] {
  const out: LifecycleMilestone[] = [];
  const push = (milestone: LifecycleMilestone["milestone"], date: string | null | undefined) => {
    if (typeof date === "string" && date.length > 0) out.push({ milestone, date });
  };
  push("release", release.releaseDate);
  push("mainstream_end", release.eoasFrom);
  push("extended_support_end", release.eoesFrom);
  push("eol", release.eolFrom);
  return out;
}

/**
 * Pick the release whose `name` matches the identity's version (prefix match, so a
 * `16.2` version resolves to the `16` release line), else the first (latest) release.
 */
export function selectRelease(product: EolProduct, version?: string | null): EolRelease | null {
  if (product.releases.length === 0) return null;
  if (version) {
    const exact = product.releases.find((r) => r.name === version);
    if (exact) return exact;
    const line = product.releases.find((r) => typeof r.name === "string" && version.startsWith(r.name));
    if (line) return line;
  }
  return product.releases[0] ?? null;
}

/** Fetch a product's lifecycle from endoflife.date v1. Returns null on any non-OK / error. */
export async function fetchEolProduct(
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<EolProduct | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(`${EOL_BASE}/api/v1/products/${encodeURIComponent(slug)}/`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: EolProduct };
    return json.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal prisma surface for the upsert — keeps this unit-testable with a mock. */
export type LifecycleUpsertClient = {
  catalogLifecycleMilestone: {
    upsert(args: unknown): Promise<unknown>;
  };
};

/**
 * Upsert the endoflife.date milestones for the release matching `version` onto a
 * CatalogIdentity. Idempotent on the (catalogIdentityId, milestone, source) unique.
 * Returns the number of milestones written.
 */
export async function upsertLifecycleForIdentity(
  db: LifecycleUpsertClient,
  catalogIdentityId: string,
  product: EolProduct,
  version?: string | null,
): Promise<number> {
  const release = selectRelease(product, version);
  if (release === null) return 0;
  const milestones = releaseToMilestones(release);
  for (const { milestone, date } of milestones) {
    const data = { date: date ? new Date(date) : null, source: SOURCE, confidence: 0.9 };
    await db.catalogLifecycleMilestone.upsert({
      where: { catalogIdentityId_milestone_source: { catalogIdentityId, milestone, source: SOURCE } },
      update: data,
      create: { catalogIdentityId, milestone, ...data },
    });
  }
  return milestones.length;
}
