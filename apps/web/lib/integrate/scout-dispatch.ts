/**
 * Scout Research Dispatch
 *
 * Fast (~30s) codebase search + URL parsing to inform clarification questions.
 * Runs before design research to identify gaps and suggest targeted questions.
 */

import type { ScoutResult } from "@/lib/explore/feature-build-types";
import { searchProjectFiles } from "./codebase-tools";

/**
 * Extract keywords from feature title and description.
 * Used to search the codebase for related models, routes, and components.
 */
function extractKeywords(title: string, description: string): string[] {
  const combined = (title + " " + description).toLowerCase();
  const words = combined.split(/\s+/).filter((w) => w.length > 3);
  const stopwords = new Set([
    "that", "with", "from", "this", "will", "should", "would", "could",
    "when", "where", "what", "which", "each", "both", "some", "many",
    "into", "onto", "over", "under", "about", "like", "more", "very",
    "also", "just", "only", "then", "than", "been", "have", "make",
  ]);
  const unique = [...new Set(words.filter((w) => !stopwords.has(w)))];
  return unique.slice(0, 5);
}

/**
 * Fetch and parse an external URL to extract page structure.
 * Returns basic HTML structure: title, headings, sections.
 */
async function fetchAndParseUrl(url: string): Promise<{
  title: string;
  sections: Array<{ heading: string; content: string }>;
  entityCount: number;
} | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Build Studio Scout/1.0" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

    // Extract headings and sections (basic parsing)
    const sections: Array<{ heading: string; content: string }> = [];
    const headingRegex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
      sections.push({ heading: match[1].trim(), content: "" });
    }

    // Remove duplicates
    const uniqueSections = Array.from(
      new Map(sections.map((s) => [s.heading, s])).values()
    );

    return {
      title,
      sections: uniqueSections.slice(0, 15), // limit to first 15 sections
      entityCount: uniqueSections.length,
    };
  } catch (err) {
    // Silently fail on fetch errors (timeout, network, etc.)
    return null;
  }
}

/**
 * Main scout dispatch function.
 * Searches codebase and parses external URLs in parallel.
 */
export async function dispatchScoutResearch(params: {
  featureTitle: string;
  featureDescription: string;
  externalUrls?: string[];
}): Promise<{ success: boolean; result?: ScoutResult; error?: string }> {
  const startTime = Date.now();

  try {
    const keywords = extractKeywords(params.featureTitle, params.featureDescription);

    // Parallel task execution with graceful error handling
    const results = await Promise.allSettled([
      // Task A: Search schema.prisma for related models
      (async () => {
        const schemaResults: ScoutResult["relatedModels"] = [];
        for (const keyword of keywords) {
          const hits = await searchProjectFiles(keyword, { glob: "**/*.prisma" });
          if (hits.results) {
            hits.results.forEach((hit) => {
              // Extract model name from line (simple heuristic)
              const modelMatch = hit.text.match(/model\s+(\w+)/);
              if (modelMatch) {
                schemaResults.push({
                  name: modelMatch[1],
                  file: hit.path,
                  line: hit.line,
                  usage: hit.text.trim().slice(0, 100),
                });
              }
            });
          }
        }
        return [...new Map(schemaResults.map((m) => [m.name, m])).values()]; // dedupe
      })(),

      // Task B: Search for related routes and components
      (async () => {
        const routes: ScoutResult["relatedRoutes"] = [];
        const components: ScoutResult["relatedComponents"] = [];

        for (const keyword of keywords) {
          const routeHits = await searchProjectFiles(keyword, {
            glob: "apps/web/app/**/*.ts",
          });
          if (routeHits.results) {
            routeHits.results.forEach((hit) => {
              if (hit.path.includes("/route.") || hit.path.includes("/route.ts")) {
                routes.push({
                  name: hit.path.split("/").pop()?.replace(".ts", "") || "route",
                  file: hit.path,
                  purpose: hit.text.slice(0, 80),
                });
              }
            });
          }

          const componentHits = await searchProjectFiles(keyword, {
            glob: "apps/web/lib/components/**/*.ts*",
          });
          if (componentHits.results) {
            componentHits.results.forEach((hit) => {
              components.push({
                name: hit.path.split("/").pop()?.replace(/\.(tsx?|jsx?)$/, "") || "component",
                file: hit.path,
                purpose: hit.text.slice(0, 80),
              });
            });
          }
        }

        return { routes: [...new Map(routes.map((r) => [r.name, r])).values()], components };
      })(),

      // Task C: Fetch and parse external URLs
      (async () => {
        if (!params.externalUrls || params.externalUrls.length === 0) {
          return null;
        }
        const externalResults = [];
        for (const url of params.externalUrls.slice(0, 3)) {
          // limit to 3 URLs
          const parsed = await fetchAndParseUrl(url);
          if (parsed) {
            externalResults.push({
              url,
              title: parsed.title,
              sections: parsed.sections,
              estimatedEntityCount: parsed.entityCount,
            });
          }
        }
        return externalResults[0] || null; // return first successful parse
      })(),
    ]);

    // Extract results
    let relatedModels: ScoutResult["relatedModels"] = [];
    let routes: ScoutResult["relatedRoutes"] = [];
    let components: ScoutResult["relatedComponents"] = [];
    let externalStructure: ScoutResult["externalStructure"] | undefined;

    if (results[0].status === "fulfilled" && results[0].value) {
      relatedModels = results[0].value;
    }

    if (results[1].status === "fulfilled" && results[1].value) {
      routes = results[1].value.routes || [];
      components = results[1].value.components || [];
    }

    if (results[2].status === "fulfilled" && results[2].value) {
      externalStructure = results[2].value as ScoutResult["externalStructure"];
    }

    // Identify gaps: concepts from external URL not found in codebase
    const gaps: ScoutResult["gaps"] = [];
    if (externalStructure) {
      const modelNames = new Set(relatedModels.map((m) => m.name.toLowerCase()));
      externalStructure.sections.forEach((section) => {
        const heading = section.heading.toLowerCase();
        // Simple heuristic: if heading is a noun (capitalized in original), check if model exists
        const singular = heading.endsWith("s") ? heading.slice(0, -1) : heading;
        if (!modelNames.has(singular) && !modelNames.has(heading)) {
          gaps.push({
            entity: section.heading,
            reason: `"${section.heading}" mentioned in external site but no corresponding model found`,
          });
        }
      });
    }

    // Generate suggested questions from gaps
    const suggestedQuestions: string[] = [];
    if (gaps.length > 0) {
      gaps.slice(0, 2).forEach((gap) => {
        suggestedQuestions.push(
          `Your site shows "${gap.entity}" — should we create a new model for this or sync with existing data?`
        );
      });
    }

    // Complexity assessment
    const modelCount = relatedModels.length;
    const integrationCount = routes.length + (externalStructure ? 1 : 0);
    let estimatedComplexity: "low" | "medium" | "high" = "low";
    let complexityReason = "";

    if (gaps.length > 0 || integrationCount > 2 || modelCount > 3) {
      estimatedComplexity = "high";
      complexityReason = `${gaps.length} gaps + ${integrationCount} integrations + ${modelCount} models`;
    } else if (gaps.length > 0 || integrationCount > 1 || modelCount > 1) {
      estimatedComplexity = "medium";
      complexityReason = `${gaps.length} gaps + ${integrationCount} integrations + ${modelCount} models`;
    } else {
      complexityReason = `${modelCount} related models found, simple integration`;
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      result: {
        relatedModels,
        relatedRoutes: routes,
        relatedComponents: components,
        externalStructure,
        gaps,
        suggestedQuestions,
        estimatedComplexity,
        complexityReason,
        scoutDurationMs: duration,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Scout dispatch failed: ${errorMsg}`,
    };
  }
}
