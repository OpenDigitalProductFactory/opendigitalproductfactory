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
  suggestedArchetypeId: string | null;
  suggestedArchetypeName: string | null;
  archetypeConfidence: "high" | "medium" | null;
  suggestedCountryCode: string | null;
  suggestedCurrency: string | null;
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
  const priority: string[] = [];   // high confidence — logo in class/id/role
  const secondary: string[] = [];  // medium — favicons, alt text matches
  const seen = new Set<string>();

  function add(url: string, isPriority: boolean) {
    try {
      const resolved = new URL(url, baseUrl).href;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        (isPriority ? priority : secondary).push(resolved);
      }
    } catch { /* invalid URL, skip */ }
  }

  // 1. <img> tags where class, id, or parent context suggests a logo
  //    Match: class="logo", class="brand-logo", class="navbar-brand", id="logo", etc.
  const imgTagMatches = html.matchAll(/<img[^>]*>/gi);
  for (const m of imgTagMatches) {
    const tag = m[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1]?.trim();
    if (!src) continue;

    const classAttr = (tag.match(/class=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    const idAttr = (tag.match(/id=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    const altAttr = (tag.match(/alt=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();

    const isLogoByAttr = /logo|brand|site-mark/i.test(classAttr)
      || /logo|brand/i.test(idAttr)
      || /logo/i.test(src);

    if (isLogoByAttr) {
      add(src, true);
    } else if (altAttr.includes("logo") || altAttr.includes("brand")) {
      add(src, true);
    }
  }

  // 2. <a> tags with logo-like class/id containing an <img>
  //    e.g., <a class="navbar-brand" href="/"><img src="..."></a>
  const logoAnchorMatches = html.matchAll(/<a[^>]*(?:class|id)=["'][^"']*(?:logo|brand|site-mark)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi);
  for (const m of logoAnchorMatches) {
    const innerImgs = m[0].matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    for (const img of innerImgs) {
      if (img[1]) add(img[1].trim(), true);
    }
  }

  // 3. <header> or <nav> containing images (first img in header is often the logo)
  //    Also check <picture><source> and <img> inside <picture>
  const headerMatch = html.match(/<header[^>]*>[\s\S]*?<\/header>/i);
  if (headerMatch) {
    // All images in header — first is highest priority
    const headerImgs = [...headerMatch[0].matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    if (headerImgs[0]?.[1]) add(headerImgs[0][1].trim(), true);
    // Also check <source> inside <picture> in header
    const headerSources = [...headerMatch[0].matchAll(/<source[^>]+srcset=["']([^"',\s]+)/gi)];
    for (const s of headerSources) {
      if (s[1] && /\.svg|\.png|\.webp/i.test(s[1])) add(s[1].trim(), true);
    }
  }
  const navMatch = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/i);
  if (navMatch) {
    const firstImg = navMatch[0].match(/<img[^>]+src=["']([^"']+)["']/i);
    if (firstImg?.[1]) add(firstImg[1].trim(), false);
  }

  // 3b. Any <img> whose src path contains common logo asset patterns
  const allImgs = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  for (const m of allImgs) {
    const src = m[1]?.trim();
    if (src && /header.*logo|logo.*header|brand.*logo|logo.*brand/i.test(src)) {
      add(src, true);
    }
  }

  // 4. og:image meta tag (often the brand logo or hero image)
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogImage?.[1]) add(ogImage[1].trim(), false);

  // 5. Favicons / apple-touch-icon (lowest priority — small, not the main logo)
  const linkMatches = html.matchAll(/<link[^>]+rel=["'][^"']*(icon|apple-touch-icon)[^"']*["'][^>]+href=["']([^"']+)["']/gi);
  for (const match of linkMatches) {
    if (match[2]) add(match[2].trim(), false);
  }

  // Re-sort: prefer logos with "white" or "light" in the path/filename
  // since the platform uses a dark theme. Push "dark" variants down.
  const all = [...priority, ...secondary];
  const preferDarkBg = (url: string): number => {
    const lower = url.toLowerCase();
    if (/[\-_/]white[\-_./]|[\-_/]light[\-_./]|[\-_/]dark-bg[\-_./]|[\-_/]reversed[\-_./]/.test(lower)) return -1;
    if (/[\-_/]dark[\-_./]|[\-_/]black[\-_./]|[\-_/]light-bg[\-_./]/.test(lower)) return 1;
    return 0;
  };
  all.sort((a, b) => preferDarkBg(a) - preferDarkBg(b));

  return all;
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

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export async function fetchPublicWebsiteEvidence(url: string): Promise<PublicWebsiteEvidence> {
  const validatedUrl = assertAllowedPublicUrl(url);

  let response = await fetch(validatedUrl.href, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  // Retry once on 403 — some CDNs/WAFs pass on second attempt
  if (response.status === 403) {
    await new Promise((r) => setTimeout(r, 1000));
    response = await fetch(validatedUrl.href, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  }

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

/**
 * Keyword catalog: maps archetype slug → display name + keywords to match in page text/title/description.
 * Ordered so more specific archetypes appear before generic ones.
 */
const ARCHETYPE_CATALOG: Array<{ id: string; name: string; keywords: string[] }> = [
  { id: "dental-practice", name: "Dental Practice", keywords: ["dentist", "dental", "orthodont", "teeth whitening", "oral health", "cosmetic dentistry"] },
  { id: "optician", name: "Optician", keywords: ["optician", "optometry", "optometrist", "eyewear", "glasses", "contact lens", "vision care", "spectacles"] },
  { id: "physiotherapy-clinic", name: "Physiotherapy Clinic", keywords: ["physiotherapy", "physiotherapist", "physical therapy", "rehab clinic", "rehabilitation"] },
  { id: "gp-surgery", name: "GP Surgery", keywords: ["gp surgery", "general practice", "family doctor", "primary care", "medical centre"] },
  { id: "pharmacy", name: "Pharmacy", keywords: ["pharmacy", "chemist", "dispensary", "prescriptions", "over the counter"] },
  { id: "hair-salon", name: "Hair Salon", keywords: ["hair salon", "hairdresser", "haircut", "hairstylist", "blow dry", "colouring", "barbershop", "barber shop"] },
  { id: "beauty-salon", name: "Beauty Salon", keywords: ["beauty salon", "nail salon", "spa treatments", "facials", "waxing", "eyelash", "eyebrow threading", "beauty clinic"] },
  { id: "tattoo-studio", name: "Tattoo Studio", keywords: ["tattoo", "piercing studio", "body art", "ink studio"] },
  { id: "fitness-gym", name: "Fitness Gym", keywords: ["gym", "fitness centre", "fitness center", "crossfit", "weightlifting", "personal training", "workout", "health club"] },
  { id: "yoga-pilates-studio", name: "Yoga / Pilates Studio", keywords: ["yoga", "pilates", "mindfulness", "meditation studio", "barre"] },
  { id: "restaurant", name: "Restaurant", keywords: ["restaurant", "bistro", "brasserie", "dining", "cuisine", "fine dining", "casual dining", "eatery"] },
  { id: "cafe-coffeeshop", name: "Café / Coffee Shop", keywords: ["cafe", "café", "coffee shop", "coffee house", "espresso bar", "bakery cafe", "brunch"] },
  { id: "bakery", name: "Bakery", keywords: ["bakery", "patisserie", "artisan bread", "pastries", "cake shop", "sourdough"] },
  { id: "bar-pub", name: "Bar / Pub", keywords: ["bar ", "pub ", "tavern", "cocktail bar", "wine bar", "brewery", "craft beer"] },
  { id: "fast-food", name: "Fast Food", keywords: ["fast food", "takeaway", "takeout", "burger joint", "fried chicken", "pizza delivery", "fish and chips"] },
  { id: "hotel", name: "Hotel", keywords: ["hotel", "boutique hotel", "inn", "lodge", "resort", "bed and breakfast", "accommodation", "rooms from"] },
  { id: "holiday-lettings", name: "Holiday Lettings", keywords: ["holiday let", "holiday rental", "vacation rental", "self catering", "airbnb", "serviced apartment"] },
  { id: "estate-agent", name: "Estate Agent", keywords: ["estate agent", "real estate", "property for sale", "property to let", "letting agent", "homes for sale"] },
  { id: "law-firm", name: "Law Firm", keywords: ["solicitor", "law firm", "legal services", "barrister", "attorney", "conveyancing", "legal advice"] },
  { id: "accountancy-firm", name: "Accountancy Firm", keywords: ["accountant", "accountancy", "chartered accountant", "bookkeeping", "tax advice", "tax return", "payroll services"] },
  { id: "financial-adviser", name: "Financial Adviser", keywords: ["financial adviser", "financial advisor", "independent financial", "ifa", "wealth management", "pensions", "investment advice"] },
  { id: "mortgage-broker", name: "Mortgage Broker", keywords: ["mortgage broker", "mortgage adviser", "home loans", "remortgage", "first time buyer"] },
  { id: "insurance-broker", name: "Insurance Broker", keywords: ["insurance broker", "insurance adviser", "life insurance", "business insurance", "car insurance", "home insurance quote"] },
  { id: "recruitment-agency", name: "Recruitment Agency", keywords: ["recruitment agency", "staffing agency", "executive search", "talent acquisition", "job placement", "headhunter"] },
  { id: "marketing-agency", name: "Marketing Agency", keywords: ["marketing agency", "digital marketing", "seo agency", "social media agency", "advertising agency", "brand agency"] },
  { id: "web-design-agency", name: "Web Design Agency", keywords: ["web design", "web development", "ux design", "app development", "software agency", "digital agency"] },
  { id: "it-managed-services", name: "IT Managed Services", keywords: ["it support", "managed it", "it services", "helpdesk", "network support", "cyber security", "it managed"] },
  { id: "consulting-firm", name: "Consulting Firm", keywords: ["consulting", "management consulting", "strategy consulting", "business consulting", "advisory services"] },
  { id: "architecture-firm", name: "Architecture Firm", keywords: ["architect", "architectural", "urban design", "interior architecture", "building design"] },
  { id: "interior-design", name: "Interior Design", keywords: ["interior design", "interior designer", "home staging", "space planning", "decor studio"] },
  { id: "photography-studio", name: "Photography Studio", keywords: ["photography", "photographer", "portrait studio", "wedding photographer", "commercial photography"] },
  { id: "events-venue", name: "Events Venue", keywords: ["events venue", "event space", "conference centre", "wedding venue", "function room", "banqueting"] },
  { id: "childcare-nursery", name: "Childcare / Nursery", keywords: ["nursery", "childcare", "day care", "pre-school", "preschool", "early years", "childminder"] },
  { id: "tutoring-centre", name: "Tutoring Centre", keywords: ["tutor", "tutoring", "private lessons", "learning centre", "exam prep", "gcse tutor", "a-level tutor"] },
  { id: "retail-fashion", name: "Retail — Fashion", keywords: ["clothing store", "fashion boutique", "menswear", "womenswear", "apparel", "streetwear", "online fashion"] },
  { id: "retail-homeware", name: "Retail — Homeware", keywords: ["homeware", "home furnishings", "furniture store", "kitchenware", "home decor shop"] },
  { id: "ecommerce-general", name: "E-commerce", keywords: ["shop now", "add to cart", "add to basket", "free delivery", "free shipping", "buy online", "online store", "online shop"] },
  { id: "nonprofit", name: "Non-Profit / Charity", keywords: ["charity", "nonprofit", "non-profit", "donation", "fundraising", "volunteer", "community interest"] },
];

type ArchetypeMatch = { id: string; name: string; score: number };

/** Detect business archetype from concatenated page text using keyword scoring. */
function detectArchetype(text: string): { id: string; name: string; confidence: "high" | "medium" } | null {
  const lower = text.toLowerCase();
  const scored: ArchetypeMatch[] = [];

  for (const entry of ARCHETYPE_CATALOG) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > 0) scored.push({ id: entry.id, name: entry.name, score });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  // High confidence: clear winner (score ≥ 2 and at least 2× the runner-up)
  const runnerUp = scored[1]?.score ?? 0;
  const confidence = top.score >= 2 && top.score >= runnerUp * 2 ? "high" : "medium";

  return { id: top.id, name: top.name, confidence };
}

/** TLD → (ISO 3166-1 alpha-2 country code, ISO 4217 currency code) */
const TLD_TO_COUNTRY: Record<string, { countryCode: string; currency: string }> = {
  uk: { countryCode: "GB", currency: "GBP" },
  co: { countryCode: "GB", currency: "GBP" }, // .co.uk — only used if hostname ends with .co.uk
  ie: { countryCode: "IE", currency: "EUR" },
  de: { countryCode: "DE", currency: "EUR" },
  fr: { countryCode: "FR", currency: "EUR" },
  es: { countryCode: "ES", currency: "EUR" },
  it: { countryCode: "IT", currency: "EUR" },
  nl: { countryCode: "NL", currency: "EUR" },
  be: { countryCode: "BE", currency: "EUR" },
  at: { countryCode: "AT", currency: "EUR" },
  pt: { countryCode: "PT", currency: "EUR" },
  ch: { countryCode: "CH", currency: "CHF" },
  se: { countryCode: "SE", currency: "SEK" },
  no: { countryCode: "NO", currency: "NOK" },
  dk: { countryCode: "DK", currency: "DKK" },
  fi: { countryCode: "FI", currency: "EUR" },
  pl: { countryCode: "PL", currency: "PLN" },
  cz: { countryCode: "CZ", currency: "CZK" },
  au: { countryCode: "AU", currency: "AUD" },
  nz: { countryCode: "NZ", currency: "NZD" },
  ca: { countryCode: "CA", currency: "CAD" },
  jp: { countryCode: "JP", currency: "JPY" },
  cn: { countryCode: "CN", currency: "CNY" },
  in: { countryCode: "IN", currency: "INR" },
  sg: { countryCode: "SG", currency: "SGD" },
  za: { countryCode: "ZA", currency: "ZAR" },
  ae: { countryCode: "AE", currency: "AED" },
  br: { countryCode: "BR", currency: "BRL" },
  mx: { countryCode: "MX", currency: "MXN" },
};

/** Phone number pattern → country/currency (fallback when TLD is .com/.org etc.) */
const PHONE_PATTERNS: Array<{ pattern: RegExp; countryCode: string; currency: string }> = [
  { pattern: /\+44[\s\d]{9,12}|\b0[1-9]\d{8,9}\b/, countryCode: "GB", currency: "GBP" },
  { pattern: /\+353[\s\d]{8,12}/, countryCode: "IE", currency: "EUR" },
  { pattern: /\+49[\s\d]{9,13}/, countryCode: "DE", currency: "EUR" },
  { pattern: /\+33[\s\d]{9,11}/, countryCode: "FR", currency: "EUR" },
  { pattern: /\+34[\s\d]{9}/, countryCode: "ES", currency: "EUR" },
  { pattern: /\+39[\s\d]{9,11}/, countryCode: "IT", currency: "EUR" },
  { pattern: /\+61[\s\d]{9,12}/, countryCode: "AU", currency: "AUD" },
  { pattern: /\+64[\s\d]{8,11}/, countryCode: "NZ", currency: "NZD" },
  { pattern: /\+1[\s\(]\d{3}[\s\-\)]\d{3}[\s\-]\d{4}/, countryCode: "US", currency: "USD" },
  { pattern: /\+1[\s\(]\d{3}[\s\-\)]\d{3}[\s\-]\d{4}.*canada|canada.*\+1/, countryCode: "CA", currency: "CAD" },
  { pattern: /\+81[\s\d]{9,12}/, countryCode: "JP", currency: "JPY" },
  { pattern: /\+91[\s\d]{10}/, countryCode: "IN", currency: "INR" },
  { pattern: /\+65[\s\d]{8}/, countryCode: "SG", currency: "SGD" },
];

/** Currency symbol patterns in body text → ISO 4217 */
const CURRENCY_SYMBOL_PATTERNS: Array<{ pattern: RegExp; currency: string }> = [
  { pattern: /£\s*\d/, currency: "GBP" },
  { pattern: /€\s*\d|\d\s*€/, currency: "EUR" },
  { pattern: /A\$\s*\d|\$\s*\d.*australia/i, currency: "AUD" },
  { pattern: /NZ\$\s*\d/, currency: "NZD" },
  { pattern: /C\$\s*\d/, currency: "CAD" },
  { pattern: /¥\s*\d|￥\s*\d/, currency: "JPY" },
  { pattern: /₹\s*\d/, currency: "INR" },
  { pattern: /S\$\s*\d/, currency: "SGD" },
  { pattern: /R\s*\d.*south africa|south africa.*R\s*\d/i, currency: "ZAR" },
  { pattern: /AED\s*\d|\d\s*AED/, currency: "AED" },
];

/** Detect country and currency from URL TLD, phone numbers, and currency symbols. */
function detectCountryAndCurrency(
  url: string,
  textExcerpt: string | null,
): { countryCode: string; currency: string } | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

    // .co.uk special case
    if (hostname.endsWith(".co.uk")) {
      return { countryCode: "GB", currency: "GBP" };
    }

    // Extract the rightmost TLD segment (e.g., "co.uk" → already handled above; "example.de" → "de")
    const parts = hostname.split(".");
    const tld = parts[parts.length - 1];
    if (tld && tld !== "com" && tld !== "org" && tld !== "net" && tld !== "io" && tld !== "app" && TLD_TO_COUNTRY[tld]) {
      return TLD_TO_COUNTRY[tld];
    }
  } catch { /* invalid URL */ }

  // Fallback: scan text excerpt for phone patterns and currency symbols
  const text = textExcerpt ?? "";

  for (const { pattern, countryCode, currency } of PHONE_PATTERNS) {
    if (pattern.test(text)) return { countryCode, currency };
  }

  for (const { pattern, currency } of CURRENCY_SYMBOL_PATTERNS) {
    if (pattern.test(text)) {
      // Derive a plausible country from the currency
      const currencyToCountry: Record<string, string> = {
        GBP: "GB", EUR: "EU", AUD: "AU", NZD: "NZ", CAD: "CA",
        JPY: "JP", INR: "IN", SGD: "SG", ZAR: "ZA", AED: "AE",
      };
      return { countryCode: currencyToCountry[currency] ?? "US", currency };
    }
  }

  return null;
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

  // Archetype detection: score against title + description + text excerpt
  const textForDetection = [
    evidence.title ?? "",
    evidence.description ?? "",
    evidence.textExcerpt ?? "",
  ].join(" ");
  const archetypeMatch = detectArchetype(textForDetection);

  // Country/currency detection: TLD first, then text signals
  const locationMatch = detectCountryAndCurrency(evidence.finalUrl, evidence.textExcerpt);

  return {
    companyName,
    logoUrl,
    paletteAccent,
    notes,
    suggestedArchetypeId: archetypeMatch?.id ?? null,
    suggestedArchetypeName: archetypeMatch?.name ?? null,
    archetypeConfidence: archetypeMatch?.confidence ?? null,
    suggestedCountryCode: locationMatch?.countryCode ?? null,
    suggestedCurrency: locationMatch?.currency ?? null,
  };
}
