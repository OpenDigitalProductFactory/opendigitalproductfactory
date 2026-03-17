type BraveSearchApiResult = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

export type NormalizedSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type PublicWebsiteEvidence = {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  textExcerpt: string | null;
  themeColor: string | null;
  logoCandidates: string[];
  colorCandidates: string[];
};

export type BrandingAnalysisResult = {
  companyName: string | null;
  logoUrl: string | null;
  paletteAccent: string | null;
  notes: string[];
};

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i,
  /^\[?fc/i,
  /^\[?fd/i,
];

function extractTextExcerpt(html: string): string | null {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped.slice(0, 500) : null;
}

function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedKey}["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedKey}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractLogoCandidates(html: string, baseUrl: string): string[] {
  const candidates = new Set<string>();

  const linkMatches = html.matchAll(/<link[^>]+rel=["'][^"']*(icon|apple-touch-icon)[^"']*["'][^>]+href=["']([^"']+)["']/gi);
  for (const match of linkMatches) {
    const href = match[2]?.trim();
    if (href) {
      candidates.add(new URL(href, baseUrl).href);
    }
  }

  const imageMatches = html.matchAll(/<img[^>]+(?:src|data-logo)=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?/gi);
  for (const match of imageMatches) {
    const src = match[1]?.trim();
    const alt = (match[2] ?? "").toLowerCase();
    if (src && (alt.includes("logo") || /logo/i.test(src))) {
      candidates.add(new URL(src, baseUrl).href);
    }
  }

  return [...candidates];
}

export function assertAllowedPublicUrl(input: string): URL {
  const url = new URL(normalizePublicFetchUrl(input));

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only public http and https URLs are allowed");
  }

  const hostname = url.hostname.replace(/\.$/, "");
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new Error("This target is not allowed for public external access");
  }

  return url;
}

export function normalizePublicFetchUrl(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(withProtocol).href;
}

export function normalizeBraveSearchResults(raw: BraveSearchApiResult): NormalizedSearchResult[] {
  return (raw.web?.results ?? [])
    .filter((result) => typeof result.title === "string" && typeof result.url === "string")
    .map((result) => ({
      title: result.title!.trim(),
      url: result.url!.trim(),
      snippet: typeof result.description === "string" ? result.description.trim() : "",
    }));
}

async function getBraveSearchApiKey(): Promise<string> {
  // Try platform config first (admin-configurable in production)
  const { prisma } = await import("@dpf/db");
  const config = await prisma.platformConfig.findUnique({
    where: { key: "brave_search_api_key" },
    select: { value: true },
  });
  if (config && typeof config.value === "string" && config.value.length > 0) {
    return config.value;
  }
  // Fall back to env var for local dev
  const envKey = process.env.BRAVE_SEARCH_API_KEY;
  if (envKey) return envKey;
  throw new Error("Brave Search API key is not configured. Set it in Platform > Admin or BRAVE_SEARCH_API_KEY env var.");
}

export class ExternalAccessNotConfiguredError extends Error {
  constructor(service: string, setupInstructions: string) {
    super(`${service} is not configured. ${setupInstructions}`);
    this.name = "ExternalAccessNotConfiguredError";
  }
}

export async function searchPublicWeb(query: string): Promise<NormalizedSearchResult[]> {
  let apiKey: string;
  try {
    apiKey = await getBraveSearchApiKey();
  } catch {
    throw new ExternalAccessNotConfiguredError(
      "Web Search (Brave)",
      "An admin needs to configure the Brave Search API key in Platform > AI Providers > Scheduled Jobs table, or ask your administrator to set it up.",
    );
  }

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Brave Search failed with HTTP ${response.status}`);
  }

  const raw = await response.json() as BraveSearchApiResult;
  return normalizeBraveSearchResults(raw);
}

export async function fetchPublicWebsiteEvidence(url: string): Promise<PublicWebsiteEvidence> {
  const validatedUrl = assertAllowedPublicUrl(url);
  const response = await fetch(validatedUrl.href, {
    headers: {
      "User-Agent": "OpenDigitalProductFactory/1.0 (https://github.com/OpenDigitalProductFactory; contact: mark@bodman.com)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Public website fetch failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const finalUrl = response.url || validatedUrl.href;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    url: validatedUrl.href,
    finalUrl,
    title: titleMatch?.[1]?.trim() ?? null,
    description: extractMetaContent(html, "description") ?? extractMetaContent(html, "og:description"),
    textExcerpt: extractTextExcerpt(html),
    themeColor: extractMetaContent(html, "theme-color"),
    logoCandidates: extractLogoCandidates(html, finalUrl),
    colorCandidates: extractColorCandidates(html),
  };
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize 3-char hex to 6-char. */
function normalizeHex(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h}`;
}

/** Check if a color is too dark or too light to be a useful brand accent. */
function isUsableAccent(hex: string): boolean {
  const h = normalizeHex(hex).replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  // Skip near-black (<25), near-white (>230), and pure grays (r≈g≈b)
  if (luminance < 25 || luminance > 230) return false;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread < 20) return false; // too gray
  return true;
}

/**
 * Extract candidate brand colors from HTML: theme-color meta, inline styles,
 * CSS blocks, and common brand patterns.
 */
function extractColorCandidates(html: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  function addCandidate(hex: string) {
    const normalized = normalizeHex(hex).toLowerCase();
    if (!seen.has(normalized) && HEX_RE.test(normalized) && isUsableAccent(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  }

  // 1. theme-color meta tag (highest priority)
  const themeColorMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  if (themeColorMatch?.[1] && HEX_RE.test(themeColorMatch[1].trim())) {
    addCandidate(themeColorMatch[1].trim());
  }

  // 2. msapplication-TileColor
  const tileMatch = html.match(/<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i);
  if (tileMatch?.[1] && HEX_RE.test(tileMatch[1].trim())) {
    addCandidate(tileMatch[1].trim());
  }

  // 3. CSS custom properties that look like brand/primary colors
  const cssVarMatches = html.matchAll(/--(?:brand|primary|accent|main|theme)[^:]*:\s*(#[0-9a-fA-F]{3,6})\b/gi);
  for (const m of cssVarMatches) {
    if (m[1]) addCandidate(m[1]);
  }

  // 4. Colors from inline styles on header, nav, and button elements
  const inlineMatches = html.matchAll(/<(?:header|nav|a|button)[^>]+style=["'][^"']*(?:background(?:-color)?|color)\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi);
  for (const m of inlineMatches) {
    if (m[1]) addCandidate(m[1]);
  }

  // 5. Colors from <style> blocks (most frequent non-grayscale hex)
  const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  const hexInCss = new Map<string, number>();
  for (const block of styleBlocks) {
    const hexMatches = block.matchAll(/#([0-9a-fA-F]{3,6})\b/g);
    for (const m of hexMatches) {
      const hex = normalizeHex(`#${m[1]}`).toLowerCase();
      if (HEX_RE.test(hex) && isUsableAccent(hex)) {
        hexInCss.set(hex, (hexInCss.get(hex) ?? 0) + 1);
      }
    }
  }
  // Sort by frequency, take top 3
  const sortedCss = [...hexInCss.entries()].sort((a, b) => b[1] - a[1]);
  for (const [hex] of sortedCss.slice(0, 3)) {
    addCandidate(hex);
  }

  return candidates;
}

export function analyzePublicWebsiteBranding(
  evidence: PublicWebsiteEvidence,
): BrandingAnalysisResult {
  const companyName = evidence.title?.trim() || evidence.description?.split(/[.|-]/)[0]?.trim() || null;
  const logoUrl = evidence.logoCandidates[0] ?? null;

  const paletteAccent = evidence.colorCandidates[0] ?? evidence.themeColor ?? null;

  const notes = [
    evidence.description ? `Description: ${evidence.description}` : null,
    evidence.textExcerpt ? `Excerpt: ${evidence.textExcerpt}` : null,
  ].filter((value): value is string => value !== null);

  return {
    companyName,
    logoUrl,
    paletteAccent,
    notes,
  };
}
