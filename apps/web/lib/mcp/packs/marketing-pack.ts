// Marketing tool pack.
//
// First marketing-domain pack. Hosts the campaign-execution helpers that do not
// need the inline switch in mcp-tools.ts. build_tracked_links is a pure UTM
// link builder (no DB, no network) used by the Marketing Strategist when
// drafting CTAs so a campaign's clicks are attributable. New marketing tools
// should land here rather than as inline cases. Grants mirror agent-grants.ts
// TOOL_TO_GRANTS (the gating source); tool-registry.test asserts no drift.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "build_tracked_links",
    description:
      "Build UTM-tagged tracked links so a campaign's clicks are measurable in analytics and CRM source attribution. Pure helper (no publish): pass a campaign/source/medium and either a single baseUrl or a links array (one utm_content per asset/variant), get normalized utm_* URLs back. Use when drafting any CTA link so the funnel can attribute inquiries to the right campaign and channel.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "Single absolute http(s) destination URL to tag. Provide this OR links." },
        links: {
          type: "array",
          description: "Multiple destinations to tag with the same campaign/source/medium; each may carry its own utm_content.",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Absolute http(s) destination URL" },
              content: { type: "string", description: "Optional utm_content for this link, e.g. post_a / cta_footer" },
            },
            required: ["url"],
          },
        },
        source: { type: "string", description: "utm_source — referrer/platform, e.g. linkedin, newsletter" },
        medium: { type: "string", description: "utm_medium — marketing medium, e.g. social, email, cpc" },
        campaign: { type: "string", description: "utm_campaign — campaign name/identifier" },
        term: { type: "string", description: "Optional utm_term — paid keyword" },
        content: { type: "string", description: "Optional default utm_content applied to links that omit their own" },
      },
      required: ["source", "medium", "campaign"],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
];

async function buildTrackedLinksHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { buildTrackedLinks } = await import("@/lib/marketing/utm");
  const links = Array.isArray(params["links"])
    ? (params["links"] as Array<{ url: string; content?: string }>)
    : undefined;
  const result = buildTrackedLinks({
    baseUrl: typeof params["baseUrl"] === "string" ? params["baseUrl"] : undefined,
    links,
    source: typeof params["source"] === "string" ? params["source"] : "",
    medium: typeof params["medium"] === "string" ? params["medium"] : "",
    campaign: typeof params["campaign"] === "string" ? params["campaign"] : "",
    term: typeof params["term"] === "string" ? params["term"] : undefined,
    content: typeof params["content"] === "string" ? params["content"] : undefined,
  });
  if (!result.success) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message, data: { links: result.links } };
}

export const marketingPack: ToolPack = {
  packId: "marketing",
  definitions,
  handlers: {
    build_tracked_links: (params) => buildTrackedLinksHandler(params),
  },
  grants: {
    build_tracked_links: ["marketing_read"],
  },
};
