// apps/web/lib/actions/hive-scout/market-sources.ts
//
// Hive Scout — market-aperture pass (BI-B8E4317D).
// Spec: docs/superpowers/specs/2026-08-16-hive-scout-market-aperture-design.md
//
// Contract:
// - Read-only scouting over an operator-editable list of public product/market
//   sources. No code is imported from any scanned source.
// - Deterministic: fetch → strip markup → bounded text → content hash →
//   changed-vs-last-run detection via the citable RawSource's structured
//   locator. Idempotent on sourceKey; re-runs never duplicate rows.
// - Per-source failures are captured, never thrown: one dead source must not
//   take down the daily catalog pass.

import { upsertRawSource } from "@dpf/db/wiki-store";
import { createHash } from "crypto";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { sourceUrlHash } from "./gap-mapping";
import type { HiveScoutPrisma } from "./ingest-db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketSource {
  /** Stable slug for the source (used in sourceKey and summaries). */
  key: string;
  title: string;
  url: string;
}

export interface MarketSourceMaterial {
  key: string;
  title: string;
  url: string;
  /** True when the stripped content hash differs from the last recorded run. */
  changed: boolean;
  /** Bounded text excerpt for the scheduled turn to reason over. */
  excerpt: string;
}

export interface MarketSourceFailure {
  key: string;
  url: string;
  error: string;
}

export interface MarketSourcePassResult {
  enabled: boolean;
  attempted: number;
  fetched: number;
  changed: number;
  failed: number;
  /** Set when the PlatformConfig override was present but malformed. */
  configFallback?: boolean;
  material: MarketSourceMaterial[];
  failures: MarketSourceFailure[];
}

// ─── Configuration ──────────────────────────────────────────────────────────

export const MARKET_ENABLED_CONFIG_KEY = "hive-scout.market.enabled";
export const MARKET_SOURCES_CONFIG_KEY = "hive-scout.market.sources";

/** Hard cap so a config mistake cannot turn the daily run into a crawler. */
export const MARKET_SOURCE_LIMIT = 12;

/** Hash window over stripped text — bounds memory on very large pages. */
export const MARKET_HASH_WINDOW_CHARS = 20_000;
/** Stored on the RawSource row for citation context. */
export const MARKET_STORED_EXCERPT_CHARS = 4_000;
/** Returned to the scheduled turn per source (keeps the turn prompt bounded). */
export const MARKET_MATERIAL_EXCERPT_CHARS = 1_500;

// Every default was verified fetchable (HTTP 200) from the live portal
// container on 2026-08-16 — sources whose WAFs reject server-side fetches are
// excluded rather than scraped around (see spec §3). Functional configuration:
// public product surfaces adjacent to DPF's space, overridable per install via
// the hive-scout.market.sources PlatformConfig row.
export const DEFAULT_MARKET_SOURCES: MarketSource[] = [
  { key: "hn-frontpage", title: "Hacker News front page (RSS)", url: "https://news.ycombinator.com/rss" },
  { key: "anthropic-news", title: "Anthropic news", url: "https://www.anthropic.com/news" },
  { key: "openai-news", title: "OpenAI news (RSS)", url: "https://openai.com/news/rss.xml" },
  { key: "linear-changelog", title: "Linear changelog", url: "https://linear.app/changelog" },
  { key: "zapier-blog", title: "Zapier blog (feed)", url: "https://zapier.com/blog/feeds/latest/" },
  { key: "odoo-news", title: "Odoo news blog", url: "https://www.odoo.com/blog/odoo-news-5" },
  { key: "frappe-blog", title: "Frappe blog", url: "https://frappe.io/blog" },
  { key: "langchain-blog", title: "LangChain blog (RSS)", url: "https://blog.langchain.dev/rss/" },
  { key: "notion-releases", title: "Notion releases", url: "https://www.notion.com/releases" },
  { key: "slack-release-notes", title: "Slack release notes", url: "https://slack.com/intl/en-gb/release-notes" },
];

type PlatformConfigReader = Pick<HiveScoutPrisma, "platformConfig">;

function parseBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (value && typeof value === "object" && "enabled" in value) {
    return parseBooleanValue((value as { enabled: unknown }).enabled, fallback);
  }
  return fallback;
}

function parseSourceList(value: unknown): MarketSource[] | null {
  const raw = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const sources: MarketSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { key, title, url } = entry as Record<string, unknown>;
    if (typeof key !== "string" || key.trim() === "") return null;
    if (typeof title !== "string" || title.trim() === "") return null;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    if (seen.has(key)) return null;
    seen.add(key);
    sources.push({ key: key.trim(), title: title.trim(), url: url.trim() });
  }
  return sources.length > 0 ? sources : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface MarketSourceSettings {
  enabled: boolean;
  sources: MarketSource[];
  /** True when an override row existed but failed shape validation. */
  configFallback: boolean;
}

export async function loadMarketSourceSettings(
  db: PlatformConfigReader,
): Promise<MarketSourceSettings> {
  const [enabledRow, sourcesRow] = await Promise.all([
    db.platformConfig.findUnique({ where: { key: MARKET_ENABLED_CONFIG_KEY }, select: { value: true } }),
    db.platformConfig.findUnique({ where: { key: MARKET_SOURCES_CONFIG_KEY }, select: { value: true } }),
  ]);

  const enabled = parseBooleanValue(enabledRow?.value, true);
  let configFallback = false;
  let sources = DEFAULT_MARKET_SOURCES;
  if (sourcesRow) {
    const parsed = parseSourceList(sourcesRow.value);
    if (parsed) {
      sources = parsed;
    } else {
      configFallback = true;
    }
  }

  return { enabled, sources: sources.slice(0, MARKET_SOURCE_LIMIT), configFallback };
}

// ─── Text extraction & change detection ─────────────────────────────────────

/**
 * Strip HTML/XML markup to visible-ish text. Works for HTML pages and for
 * RSS/Atom feeds (tags stripped, titles/descriptions survive). Mirrors the
 * script/style handling in public-web-tools.ts.
 */
export function extractMarketText(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " ")
    .replace(/<!\[CDATA\[/g, " ")
    .replace(/\]\]>/g, " ")
    .replace(/<[^<>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function marketContentHash(text: string): string {
  return createHash("sha256").update(text.slice(0, MARKET_HASH_WINDOW_CHARS)).digest("hex");
}

export function marketSourceKey(url: string): string {
  return `hive-scout:market:${sourceUrlHash(url)}`;
}

type MarketLocator = {
  kind: "hive-scout-market";
  url: string;
  contentHash: string;
  fetchedAt: string;
};

function priorContentHash(locator: unknown): string | null {
  if (!locator || typeof locator !== "object") return null;
  const candidate = locator as Partial<MarketLocator>;
  return candidate.kind === "hive-scout-market" && typeof candidate.contentHash === "string"
    ? candidate.contentHash
    : null;
}

// ─── The pass ───────────────────────────────────────────────────────────────

export interface MarketSourcePassOptions {
  db: Pick<HiveScoutPrisma, "platformConfig" | "rawSource">;
  fetcher: (url: string) => Promise<string>;
  now?: Date;
}

export async function runMarketSourcePass(
  options: MarketSourcePassOptions,
): Promise<MarketSourcePassResult> {
  const { db, fetcher } = options;
  const settings = await loadMarketSourceSettings(db);

  const result: MarketSourcePassResult = {
    enabled: settings.enabled,
    attempted: 0,
    fetched: 0,
    changed: 0,
    failed: 0,
    ...(settings.configFallback ? { configFallback: true } : {}),
    material: [],
    failures: [],
  };
  if (!settings.enabled) return result;

  for (const source of settings.sources) {
    result.attempted++;
    try {
      const markup = await fetcher(source.url);
      const text = extractMarketText(markup);
      const contentHash = marketContentHash(text);
      const sourceKey = marketSourceKey(source.url);

      const prior = await db.rawSource.findUnique({
        where: { sourceKey },
        select: { locator: true },
      });
      const changed = priorContentHash(prior?.locator) !== contentHash;

      const fetchedAt = options.now ?? new Date();
      const locator: MarketLocator = {
        kind: "hive-scout-market",
        url: source.url,
        contentHash,
        fetchedAt: fetchedAt.toISOString(),
      };
      await upsertRawSource(db, {
        sourceKey,
        sourceType: "external-url",
        title: source.title,
        url: source.url,
        excerpt: text.slice(0, MARKET_STORED_EXCERPT_CHARS) || null,
        locator,
        retrievedAt: fetchedAt,
        organizationId: null,
        isKernel: false,
      });

      result.fetched++;
      if (changed) result.changed++;
      result.material.push({
        key: source.key,
        title: source.title,
        url: source.url,
        changed,
        excerpt: text.slice(0, MARKET_MATERIAL_EXCERPT_CHARS),
      });
    } catch (error) {
      result.failed++;
      result.failures.push({
        key: source.key,
        url: source.url,
        error: getErrorMessage(error),
      });
    }
  }

  return result;
}
