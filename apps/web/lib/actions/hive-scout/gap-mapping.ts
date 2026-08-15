// apps/web/lib/actions/hive-scout/gap-mapping.ts
//
// Hive Scout — value-stream mapping, dedupe/idempotency keys, gap detection,
// and backlog-item body rendering. Pure functions, no I/O.

import { createHash } from "crypto";
import { slugify } from "@/lib/shared/slugify";
import { CATALOG_LICENSE, CATALOG_NAME, type CatalogEntry } from "./catalog-readme";

const ITEM_ID_PREFIX = "HS";

// A starter mapping from catalog-industry labels to IT4IT value-stream names
// as seeded into `EaReferenceModelElement` (kind="value_stream"). Entries are
// only included when the industry clearly aligns with an IT4IT stream. Any
// industry not found here is filed as status="triaging" with
// VALUE_STREAM_CONFIDENCE="needs-mapping" so a human completes the mapping
// before the item is prioritised — per the spec's ambiguity rule.
const INDUSTRY_TO_VALUE_STREAM: Record<string, string> = {
  "devops": "Operate",
  "it operations": "Operate",
  "sre": "Operate",
  "site reliability": "Operate",
  "cybersecurity": "Operate",
  "security": "Operate",
  "monitoring": "Operate",
  "observability": "Operate",
  "developer tools": "Integrate",
  "development": "Integrate",
  "software engineering": "Integrate",
  "coding": "Integrate",
  "data engineering": "Integrate",
  "qa": "Integrate",
  "testing": "Integrate",
  "research": "Evaluate",
  "portfolio": "Evaluate",
  "strategy": "Evaluate",
  "product management": "Evaluate",
  "product": "Evaluate",
  "discovery": "Explore",
  "ideation": "Explore",
  "ai integration": "Explore",
  "knowledge management": "Explore",
  "deployment": "Deploy",
  "infrastructure": "Deploy",
  "release management": "Release",
  "devrel": "Release",
  "documentation": "Release",
  "customer service": "Consume",
  "customer support": "Consume",
  "support": "Consume",
  "marketing": "Consume",
  "sales": "Consume",
  "e-commerce": "Consume",
  "retail": "Consume",
};

export interface ValueStreamMatch {
  stream: string | null;
  confidence: "mapped" | "needs-mapping";
}

// ─── Value-stream mapping ───────────────────────────────────────────────────

/**
 * Map a catalog-industry label to a seeded IT4IT value-stream name.
 * Returns `confidence: "mapped"` when a starter-mapping entry exists AND the
 * stream is present in the seeded `EaReferenceModelElement` catalog.
 * Otherwise `confidence: "needs-mapping"`, which forces the BacklogItem into
 * the `triaging` status for human review.
 */
export function mapIndustryToStream(
  industry: string,
  seededStreamNames: Set<string>,
): ValueStreamMatch {
  const candidate = INDUSTRY_TO_VALUE_STREAM[industry.trim().toLowerCase()];
  if (!candidate) return { stream: null, confidence: "needs-mapping" };
  if (!seededStreamNames.has(candidate)) {
    // Mapping exists in code but the stream isn't in the DB yet — treat as
    // needs-mapping rather than silently linking to a nonexistent stream.
    return { stream: null, confidence: "needs-mapping" };
  }
  return { stream: candidate, confidence: "mapped" };
}

// ─── Dedupe / idempotency ───────────────────────────────────────────────────

/**
 * Deterministic BacklogItem.itemId derived from the source URL.
 * 16 hex chars of SHA-256 keeps collisions astronomically unlikely across the
 * ~500 entries while staying short enough to read in the UI.
 */
export function itemIdForSource(sourceUrl: string): string {
  const digest = sourceUrlHash(sourceUrl).slice(0, 16);
  return `${ITEM_ID_PREFIX}-${digest.toUpperCase()}`;
}

export function sourceUrlHash(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex");
}

const RAW_SOURCE_KEY_PREFIX = "hive-scout:500-ai-agents";

/**
 * Stable, human-readable key for `RawSource.sourceKey`. Idempotency depends
 * on this returning the same string for the same source URL across runs.
 *
 * Shape: `hive-scout:500-ai-agents:<canonical-slug>` where the slug is
 * derived from the URL host + path with non-alphanumerics collapsed to
 * single dashes. Scheme, userinfo, port, query, and fragment are stripped
 * so cosmetic URL variations do not split a single logical source into
 * two RawSource rows.
 */
export function rawSourceKeyForEntry(entry: Pick<CatalogEntry, "sourceUrl">): string {
  return `${RAW_SOURCE_KEY_PREFIX}:${canonicalSlugForUrl(entry.sourceUrl)}`;
}

function canonicalSlugForUrl(rawUrl: string): string {
  let canonical: string;
  try {
    const parsed = new URL(rawUrl.trim());
    // host (no userinfo, no port) + pathname only; query + fragment dropped.
    canonical = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    // Lenient fallback for malformed URLs — preserves a key rather than
    // throwing mid-ingest. Strip scheme + userinfo + port + query/fragment.
    canonical = rawUrl
      .trim()
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/^[^/@]*@/, "")
      .replace(/:\d+/, "")
      .split(/[?#]/)[0];
  }
  return slugify(canonical.replace(/\.git$/i, ""));
}

// ─── Gap detection ──────────────────────────────────────────────────────────

function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when no existing skill or coworker archetype plausibly covers
 * the catalog entry. Matching is deliberately conservative — we'd rather file
 * a duplicate-looking suggestion than silently discard a real gap; humans
 * can reject it in one click.
 */
export function isGap(
  entry: CatalogEntry,
  existingSkillNames: string[],
  existingCoworkerNames: string[],
): boolean {
  const needle = normaliseForMatch(entry.name);
  if (!needle) return false;

  const tokens = needle.split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return true;

  const haystacks = [...existingSkillNames, ...existingCoworkerNames].map(normaliseForMatch);

  // A skill/coworker "covers" the entry if any single long token from the
  // entry name appears verbatim in its name. This is coarse but prevents the
  // trivial "Trading Bot"/"Trading" collisions while letting genuinely new
  // archetypes through.
  return !haystacks.some((h) => tokens.some((t) => h.includes(t)));
}

// ─── Description rendering ──────────────────────────────────────────────────

// Backlog-item body template (not a coworker persona). Lives under
// prompts/templates/ to keep prompts/specialist/ scoped to actual specialists.
export const PROMPT_CATEGORY = "templates";
export const PROMPT_SLUG = "hive-scout-archetype-gap";

export const FALLBACK_BODY_TEMPLATE = `**Use case:** {{NAME}}

**Industry (as labelled upstream):** {{INDUSTRY}}

**Upstream description:** {{DESCRIPTION}}

**Source:** {{SOURCE_URL}}
**Catalog:** {{CATALOG_NAME}} ({{CATALOG_LICENSE}})
**Framework (if any):** {{FRAMEWORK}}

**Candidate IT4IT value stream:** {{VALUE_STREAM}} ({{VALUE_STREAM_CONFIDENCE}})

---

Reference only — not vendored. The linked repository is MIT-licensed
inspiration for a DPF-native archetype; we do not import its code.`;

export function renderBody(
  template: string,
  entry: CatalogEntry,
  match: ValueStreamMatch,
): string {
  const substitutions: Record<string, string> = {
    NAME: entry.name,
    INDUSTRY: entry.industry,
    DESCRIPTION: entry.description,
    SOURCE_URL: entry.sourceUrl,
    VALUE_STREAM: match.stream ?? "(none)",
    VALUE_STREAM_CONFIDENCE: match.confidence,
    FRAMEWORK: entry.framework ?? "(none)",
    CATALOG_NAME,
    CATALOG_LICENSE,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    substitutions[key] ?? `{{${key}}}`,
  );
}
