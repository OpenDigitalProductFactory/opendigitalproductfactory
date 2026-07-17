// Hardware model lifecycle feeds (BI-84710E60, HAM Phase D1, spec §5.2). Layers
// hardware-specific EOL / end-of-sale posture onto CatalogIdentity(part='h') from open
// feeds:
//   - endoflife.date hardware pages: `discontinued` → end-of-sale (device no longer
//     sold/manufactured); `eol` → end of support; `eoes` → extended-support end (eosl).
//   - Wikidata `discontinuation date` (P2669) → low-confidence end-of-sale backfill
//     when a model-specific vendor / endoflife.date date is absent.
//
// Milestone names are kept CLOSED in code next to the mapper so drift is testable
// (spec §7). Each (catalogIdentity, milestone, source) is upserted independently — the
// unique key preserves per-source provenance and never flattens two sources into one
// date (spec §5.2 step 4). Fetchers are injectable so the mapping + upsert are
// fixture-tested with no network. LVFS/fwupd firmware hints are a separate follow-up.

import {
  fetchEolProduct,
  selectRelease,
  type EolProduct,
  type EolRelease,
  type LifecycleUpsertClient,
} from "./endoflife-lifecycle";
import { deriveEolSlug } from "./enrich-digital-product";

/** Closed hardware-milestone vocabulary (spec §5.2). */
export const HARDWARE_MILESTONES = [
  "release",
  "end_of_sale",
  "end_of_manufacture",
  "eol",
  "eosl",
  "firmware_security_updates_end",
] as const;
export type HardwareMilestone = (typeof HARDWARE_MILESTONES)[number];

const EOL_SOURCE = "endoflife.date";
const WIKIDATA_SOURCE = "wikidata";
const EOL_CONFIDENCE = 0.9;
// Wikidata is a public crowd-sourced backfill — deliberately low so a vendor/endoflife
// date always wins the operator-facing posture even though both rows are retained.
const WIKIDATA_CONFIDENCE = 0.4;

const WIKIDATA_API = process.env.WIKIDATA_API_BASE ?? "https://www.wikidata.org/w/api.php";
const TIMEOUT_MS = Number(process.env.WIKIDATA_TIMEOUT_MS ?? 20000);

export type HardwareLifecycleMilestone = {
  milestone: HardwareMilestone;
  date: string | null;
  source: string;
  confidence: number;
};

/**
 * Map one endoflife.date hardware release onto hardware milestones. Emits only
 * milestones that carry a date, so an unknown field never overwrites a known one.
 * Hardware reads `discontinuedFrom` (end-of-sale) in addition to the shared eol/eoes.
 */
export function hardwareReleaseToMilestones(release: EolRelease): HardwareLifecycleMilestone[] {
  const out: HardwareLifecycleMilestone[] = [];
  const push = (milestone: HardwareMilestone, date: string | null | undefined) => {
    if (typeof date === "string" && date.length > 0) {
      out.push({ milestone, date, source: EOL_SOURCE, confidence: EOL_CONFIDENCE });
    }
  };
  push("release", release.releaseDate);
  push("end_of_sale", release.discontinuedFrom);
  push("eol", release.eolFrom);
  push("eosl", release.eoesFrom);
  return out;
}

/** Parse a Wikidata time literal (`+2019-09-10T00:00:00Z`) to `YYYY-MM-DD`, or null. */
export function parseWikidataTime(time: string | null | undefined): string | null {
  if (typeof time !== "string") return null;
  const m = time.match(/^[+-]?(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/**
 * Best-effort Wikidata discontinuation date (P2669) for a hardware model. Searches for
 * "manufacturer product", takes the top item, and reads its first P2669 claim. Returns
 * the date string or null on any non-OK / no-match / error — never throws.
 */
export async function fetchWikidataDiscontinuation(
  manufacturer: string,
  product: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const term = `${manufacturer} ${product}`.trim();
    if (term === "") return null;
    const searchUrl =
      `${WIKIDATA_API}?action=wbsearchentities&format=json&language=en&type=item&limit=1` +
      `&search=${encodeURIComponent(term)}`;
    const searchRes = await fetcher(searchUrl, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as { search?: Array<{ id?: string }> };
    const entityId = searchJson.search?.[0]?.id;
    if (!entityId) return null;

    const claimsUrl = `${WIKIDATA_API}?action=wbgetclaims&format=json&property=P2669&entity=${encodeURIComponent(entityId)}`;
    const claimsRes = await fetcher(claimsUrl, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!claimsRes.ok) return null;
    const claimsJson = (await claimsRes.json()) as {
      claims?: { P2669?: Array<{ mainsnak?: { datavalue?: { value?: { time?: string } } } }> };
    };
    const time = claimsJson.claims?.P2669?.[0]?.mainsnak?.datavalue?.value?.time;
    return parseWikidataTime(time);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upsert a set of hardware milestones onto a CatalogIdentity. Idempotent on the
 * (catalogIdentityId, milestone, source) unique. Returns the number written.
 */
export async function upsertHardwareMilestones(
  db: LifecycleUpsertClient,
  catalogIdentityId: string,
  milestones: HardwareLifecycleMilestone[],
): Promise<number> {
  for (const { milestone, date, source, confidence } of milestones) {
    const data = { date: date ? new Date(date) : null, source, confidence };
    await db.catalogLifecycleMilestone.upsert({
      where: { catalogIdentityId_milestone_source: { catalogIdentityId, milestone, source } },
      update: data,
      create: { catalogIdentityId, milestone, ...data },
    });
  }
  return milestones.length;
}

export type HardwareIdentityInput = {
  id: string;
  manufacturer: string;
  product: string;
  productVersion: string | null;
};

export type HardwareFetchers = {
  /** endoflife.date fetcher; defaults to global fetch. */
  eolFetch?: typeof fetch;
  /** Wikidata fetcher; when omitted the Wikidata backfill is skipped. */
  wikidataFetch?: typeof fetch;
};

export type HardwareEnrichResult = {
  milestonesWritten: number;
  eolMatched: boolean;
  wikidataMatched: boolean;
  // Every milestone written this pass — the sweep derives InventoryEntity support posture
  // from these without a re-read (BI-4731303B).
  milestones: HardwareLifecycleMilestone[];
};

/**
 * Enrich one hardware CatalogIdentity(part='h') from the open model feeds: endoflife.date
 * hardware lifecycle + Wikidata discontinuation backfill. Both sources are retained
 * independently. Never throws on feed failure (the fetchers already swallow to null).
 */
export async function enrichHardwareIdentity(
  db: LifecycleUpsertClient,
  identity: HardwareIdentityInput,
  fetchers: HardwareFetchers = {},
): Promise<HardwareEnrichResult> {
  const result: HardwareEnrichResult = {
    milestonesWritten: 0,
    eolMatched: false,
    wikidataMatched: false,
    milestones: [],
  };

  const slug = deriveEolSlug(identity);
  if (slug) {
    const product: EolProduct | null = await fetchEolProduct(slug, fetchers.eolFetch ?? fetch);
    if (product) {
      const release = selectRelease(product, identity.productVersion);
      if (release) {
        const milestones = hardwareReleaseToMilestones(release);
        if (milestones.length > 0) {
          result.eolMatched = true;
          result.milestones.push(...milestones);
          result.milestonesWritten += await upsertHardwareMilestones(db, identity.id, milestones);
        }
      }
    }
  }

  if (fetchers.wikidataFetch) {
    const discontinued = await fetchWikidataDiscontinuation(
      identity.manufacturer,
      identity.product,
      fetchers.wikidataFetch,
    );
    if (discontinued) {
      result.wikidataMatched = true;
      const wikidataMilestones: HardwareLifecycleMilestone[] = [
        { milestone: "end_of_sale", date: discontinued, source: WIKIDATA_SOURCE, confidence: WIKIDATA_CONFIDENCE },
      ];
      result.milestones.push(...wikidataMilestones);
      result.milestonesWritten += await upsertHardwareMilestones(db, identity.id, wikidataMilestones);
    }
  }

  return result;
}
