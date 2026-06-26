// Marketing execution — UTM / tracked-link builder.
//
// A campaign is only "executed" if its links are measurable. Every
// best-in-class marketing assistant can produce UTM-tagged links so the
// downstream funnel (analytics, CRM source attribution) can tell which
// campaign / channel / asset drove an inquiry. This is a pure, deterministic
// helper — no DB, no network — so the coworker can mint tracked links inline
// while drafting CTAs and the result is unit-testable.
//
// Convention (Google Analytics standard): utm_source, utm_medium,
// utm_campaign are required; utm_term and utm_content are optional. Values are
// normalized to a lowercase, underscore-joined slug so the same logical
// campaign does not fragment into "Summer Push" vs "summer_push" in reports.

export type UtmParams = {
  /** utm_source — the referrer/platform, e.g. "linkedin", "newsletter". */
  source: string;
  /** utm_medium — the marketing medium, e.g. "social", "email", "cpc". */
  medium: string;
  /** utm_campaign — the campaign name/identifier. */
  campaign: string;
  /** utm_term — optional paid-keyword term. */
  term?: string;
  /** utm_content — optional asset/variant differentiator, e.g. "post_a". */
  content?: string;
};

export type TrackedLink = {
  /** The original, untagged URL as supplied. */
  sourceUrl: string;
  /** The URL with normalized utm_* parameters applied. */
  trackedUrl: string;
  /** The utm_content value applied to this specific link, if any. */
  content?: string;
};

export type BuildTrackedLinksInput = UtmParams & {
  /**
   * Base destination URL when minting a single link. Provide this OR `links`.
   * Must be an absolute http(s) URL.
   */
  baseUrl?: string;
  /**
   * Multiple destinations to tag with the same campaign/source/medium. Each
   * entry may carry its own utm_content (e.g. one per asset variant). When a
   * link omits content, the top-level `content` (if any) is used.
   */
  links?: Array<{ url: string; content?: string }>;
};

export type BuildTrackedLinksResult =
  | { success: true; links: TrackedLink[]; message: string }
  | { success: false; error: string; message: string };

/**
 * Normalize a UTM value to a lowercase, underscore-joined slug.
 * Keeps a–z, 0–9, underscore, hyphen and dot; collapses any other run
 * (including whitespace) to a single underscore; trims leading/trailing
 * separators. Returns "" for input that is empty after normalization.
 */
export function normalizeUtmValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function isHttpUrl(candidate: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

/**
 * Apply normalized utm_* parameters to a single absolute http(s) URL,
 * preserving any existing query string and hash fragment. Existing utm_*
 * params on the URL are overwritten (last-write-wins) so re-tagging is
 * idempotent. Returns null if the URL is not a valid http(s) URL.
 */
export function applyUtm(
  url: string,
  params: UtmParams & { content?: string },
): string | null {
  const parsed = isHttpUrl(url);
  if (!parsed) return null;

  const pairs: Array<[string, string]> = [
    ["utm_source", normalizeUtmValue(params.source)],
    ["utm_medium", normalizeUtmValue(params.medium)],
    ["utm_campaign", normalizeUtmValue(params.campaign)],
  ];
  if (params.term) pairs.push(["utm_term", normalizeUtmValue(params.term)]);
  if (params.content) pairs.push(["utm_content", normalizeUtmValue(params.content)]);

  for (const [key, val] of pairs) {
    if (val) parsed.searchParams.set(key, val);
  }
  return parsed.toString();
}

/**
 * Mint one or more tracked links from a single base URL or a list of URLs,
 * all sharing the same campaign/source/medium. Pure and deterministic.
 */
export function buildTrackedLinks(
  input: BuildTrackedLinksInput,
): BuildTrackedLinksResult {
  const missing: string[] = [];
  if (!input.source?.trim()) missing.push("source");
  if (!input.medium?.trim()) missing.push("medium");
  if (!input.campaign?.trim()) missing.push("campaign");
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing-required-params",
      message: `Cannot build tracked links — missing required UTM field(s): ${missing.join(", ")}.`,
    };
  }

  const targets: Array<{ url: string; content?: string }> = [];
  if (input.links && input.links.length > 0) {
    targets.push(...input.links);
  } else if (input.baseUrl) {
    targets.push({ url: input.baseUrl, content: input.content });
  } else {
    return {
      success: false,
      error: "no-target-url",
      message: "Provide either baseUrl or a non-empty links array to tag.",
    };
  }

  const links: TrackedLink[] = [];
  const invalid: string[] = [];
  for (const target of targets) {
    const content = target.content ?? input.content;
    const trackedUrl = applyUtm(target.url, {
      source: input.source,
      medium: input.medium,
      campaign: input.campaign,
      term: input.term,
      content,
    });
    if (!trackedUrl) {
      invalid.push(target.url);
      continue;
    }
    links.push({
      sourceUrl: target.url,
      trackedUrl,
      ...(content ? { content: normalizeUtmValue(content) } : {}),
    });
  }

  if (links.length === 0) {
    return {
      success: false,
      error: "no-valid-urls",
      message: `No valid http(s) URLs to tag. Rejected: ${invalid.join(", ") || "(none provided)"}.`,
    };
  }

  const skipped = invalid.length > 0 ? ` Skipped ${invalid.length} invalid URL(s): ${invalid.join(", ")}.` : "";
  return {
    success: true,
    links,
    message: `Built ${links.length} tracked link(s) for campaign "${normalizeUtmValue(input.campaign)}".${skipped}`,
  };
}
