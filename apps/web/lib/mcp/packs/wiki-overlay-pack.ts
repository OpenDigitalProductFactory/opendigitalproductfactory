// Wiki-overlay publishing tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "org-overlay wiki draft review + batch publish"
// domain out of the mcp-tools.ts executeTool switch: listing the pending draft
// pages in the current org's wiki overlay, and flipping a batch of overlay
// pages to a target status (default 'published'). Both handlers are thin lazy
// delegations to the shared wiki-publish server actions
// (@/lib/actions/wiki-publish), so behaviour is identical when invoked over MCP.
//
// Definitions are moved verbatim out of the inline PLATFORM_TOOLS array
// (including the read-only vs proposal execution modes and the MCP annotations).
// Grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "list_wiki_overlay_drafts",
    description:
      "List every wiki page in the current org's overlay that is still in draft status. Returns each page's slug, kind, abstract, body length + 800-char preview, kernel-override pointer, and the slug list of cited raw sources. Use this when the user asks 'what wiki drafts are pending review' or before walking them through a batch publish — the structured result feeds the review-wiki-drafts skill.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "publish_wiki_overlay_pages",
    description:
      "Flip status on a batch of org-overlay wiki pages (default target: 'published'). Each flipped page gets a manual revision row attributed to the calling user. Kernel pages, cross-org pages, missing pages, and pages already at the target status are filtered out and reported in rejected[]. Use after walking the user through pending drafts via list_wiki_overlay_drafts — pass the ids the user said to keep.",
    inputSchema: {
      type: "object",
      properties: {
        pageIds: {
          type: "array",
          items: { type: "string" },
          description: "WikiPage row ids to flip.",
        },
        targetStatus: {
          type: "string",
          enum: ["draft", "published", "review-needed", "archived"],
          description: "Status to flip to (default 'published').",
        },
        changeSummary: {
          type: "string",
          description: "Optional summary written to the revision log for every flipped page.",
        },
      },
      required: ["pageIds"],
    },
    requiredCapability: null,
    executionMode: "proposal",
    sideEffect: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

async function listWikiOverlayDraftsHandler(): Promise<ToolResult> {
  const { listOverlayDrafts } = await import("@/lib/actions/wiki-publish");
  try {
    const drafts = await listOverlayDrafts();
    if (drafts.length === 0) {
      return {
        success: true,
        message: "No pending drafts in this org's overlay.",
        data: { drafts: [] },
      };
    }
    const summary = drafts
      .map((d, i) => {
        const sourceTag =
          d.sourceSlugs.length > 0
            ? ` · cites ${d.sourceSlugs.slice(0, 2).join(", ")}${d.sourceSlugs.length > 2 ? `, +${d.sourceSlugs.length - 2}` : ""}`
            : "";
        const overrideTag = d.kernelPageId ? " · overrides kernel" : "";
        return `${i + 1}. ${d.slug} (${d.pageKind}, ${d.bodyLength} bytes${overrideTag}${sourceTag})`;
      })
      .join("\n");
    return {
      success: true,
      message: `${drafts.length} draft(s) pending:\n${summary}`,
      data: { drafts },
    };
  } catch (err) {
    return {
      success: false,
      message: `list_wiki_overlay_drafts failed: ${(err as Error).message ?? String(err)}`,
      error: (err as Error).message ?? String(err),
    };
  }
}

async function publishWikiOverlayPagesHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const pageIds = Array.isArray(params["pageIds"]) ? params["pageIds"] : null;
  if (!pageIds || pageIds.length === 0) {
    return {
      success: false,
      message: "publish_wiki_overlay_pages requires a non-empty pageIds array.",
      error: "Empty pageIds",
    };
  }
  const targetStatusParam = params["targetStatus"];
  const targetStatus =
    typeof targetStatusParam === "string" &&
    ["draft", "published", "review-needed", "archived"].includes(
      targetStatusParam,
    )
      ? (targetStatusParam as "draft" | "published" | "review-needed" | "archived")
      : "published";
  const changeSummary =
    typeof params["changeSummary"] === "string"
      ? (params["changeSummary"] as string)
      : undefined;

  const { publishWikiOverlayPages } = await import(
    "@/lib/actions/wiki-publish"
  );
  const result = await publishWikiOverlayPages({
    pageIds: pageIds.map((id) => String(id)),
    targetStatus,
    ...(changeSummary ? { changeSummary } : {}),
  });
  if (!result.ok) {
    return {
      success: false,
      message: result.error,
      error: result.error,
    };
  }
  const publishedTag =
    result.published.length === 0
      ? "0 published"
      : `Published ${result.published.length}: ${result.published
          .map((p) => p.slug)
          .slice(0, 6)
          .join(", ")}${result.published.length > 6 ? `, +${result.published.length - 6}` : ""}`;
  const rejectedTag =
    result.rejected.length === 0
      ? ""
      : ` · Rejected ${result.rejected.length} (` +
        Object.entries(
          result.rejected.reduce<Record<string, number>>((acc, r) => {
            acc[r.reason] = (acc[r.reason] ?? 0) + 1;
            return acc;
          }, {}),
        )
          .map(([reason, n]) => `${reason}=${n}`)
          .join(", ") +
        ")";
  return {
    success: true,
    message: `${publishedTag}${rejectedTag}`,
    data: result,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_wiki_overlay_drafts: () => listWikiOverlayDraftsHandler(),
  publish_wiki_overlay_pages: (params) => publishWikiOverlayPagesHandler(params),
};

export const wikiOverlayPack: ToolPack = {
  packId: "wiki-overlay",
  definitions,
  handlers,
  grants: {
    list_wiki_overlay_drafts: ["registry_read"],
    publish_wiki_overlay_pages: ["registry_write"],
  },
};
