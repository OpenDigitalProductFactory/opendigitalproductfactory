import {
  fetchPublicWebsiteEvidence,
  analyzePublicWebsiteBranding,
} from "@/lib/public-web-tools";
import type { PartialDesignSystem } from "./types";

export async function urlAdapter(url: string): Promise<PartialDesignSystem> {
  const gaps: string[] = [];
  const perField: Record<string, number> = {};

  let evidence: Awaited<ReturnType<typeof fetchPublicWebsiteEvidence>>;
  try {
    evidence = await fetchPublicWebsiteEvidence(url);
  } catch (err) {
    return {
      sources: [{ kind: "url", ref: url, capturedAt: new Date().toISOString() }],
      gaps: ["url-fetch-failed", err instanceof Error ? `url-fetch-error: ${err.message}` : "url-fetch-error"],
      confidence: { overall: 0, perField: {} },
    };
  }

  const analysis = analyzePublicWebsiteBranding(evidence);

  const partial: PartialDesignSystem = {
    sources: [{ kind: "url", ref: evidence.finalUrl, capturedAt: new Date().toISOString() }],
  };

  if (analysis.companyName) {
    partial.identity = {
      name: analysis.companyName,
      tagline: null,
      description: analysis.suggestedDescription ?? null,
      logo: {
        darkBg: null,
        lightBg: null,
        mark: analysis.logoUrl
          ? { url: analysis.logoUrl, source: "scraped" }
          : null,
      },
      voice: { tone: "neutral", sampleCopy: [] },
    };
    perField["identity.name"] = 0.7;
    if (analysis.logoUrl) perField["identity.logo.mark"] = 0.7;
  } else {
    gaps.push("url-no-company-name");
  }

  if (analysis.paletteAccent) {
    partial.palette = {
      primary: analysis.paletteAccent,
      secondary: evidence.colorCandidates[1] ?? null,
      accents: evidence.colorCandidates.slice(2, 5),
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
        500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
      },
      surfaces: {
        background: "#ffffff",
        foreground: "#000000",
        muted: "#f5f5f5",
        card: "#ffffff",
        border: "#e5e5e5",
      },
    };
    perField["palette.primary"] = 0.7;
  } else {
    gaps.push("url-no-palette");
  }

  const populatedFields = Object.keys(perField).length;
  const overall = populatedFields === 0 ? 0 : Math.min(0.7, populatedFields * 0.25);

  return {
    ...partial,
    gaps,
    confidence: { overall, perField },
  };
}
