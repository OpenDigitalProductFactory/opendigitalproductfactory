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

export async function searchPublicWeb(query: string): Promise<NormalizedSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API_KEY is not configured");
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
      "User-Agent": "DigitalProductFactory/1.0 (+public-web-fetch)",
      Accept: "text/html,application/xhtml+xml",
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
  };
}

export function analyzePublicWebsiteBranding(
  evidence: PublicWebsiteEvidence,
): BrandingAnalysisResult {
  const companyName = evidence.title?.trim() || evidence.description?.split(/[.|-]/)[0]?.trim() || null;
  const logoUrl = evidence.logoCandidates[0] ?? null;
  const paletteAccent = evidence.themeColor;
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
