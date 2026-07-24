// update_backlog_item MCP handler (extracted from mcp-tools.ts).
//
// Edits an existing backlog item's fields and — the BI-87A8BF2A structural write
// path — associates it with a DigitalProduct / taxonomy node / portfolio, then
// re-derives the denormalized BacklogItem.portfolioId via the canonical
// DigitalProduct -> taxonomy -> epic resolver. Status transitions still route
// through the dedicated status/triage tools.

import { attributeBacklogPortfolio, prisma } from "@dpf/db";
import { BACKLOG_SCOPE_KIND_VALUES } from "@/lib/explore/backlog";
import type { ToolResult } from "../mcp-tools";

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
  return cleaned;
}

export async function handleUpdateBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  const existing = await prisma.backlogItem.findUnique({ where: { itemId: String(params["itemId"]) } });
  if (!existing) return { success: false, error: "Item not found", message: `Item ${String(params["itemId"])} not found` };
  const data: Record<string, unknown> = {};
  if (typeof params["title"] === "string") data["title"] = params["title"];
  if (typeof params["status"] === "string") {
    // Block direct status mutations that should go through dedicated tools.
    // - Setting status='triaging' on an already-triaged item: use the retriage flow.
    // - Leaving triaging without going through triage_backlog_item: skips rationale + audit.
    if (params["status"] === "triaging" && existing.status !== "triaging") {
      return {
        success: false,
        error: "use_update_backlog_item_status_for_retriage",
        message: "To move a triaged item back to triaging, use update_backlog_item_status (it requires a reason and audits the retriage). update_backlog_item is for editing fields, not for status transitions.",
      };
    }
    if (existing.status === "triaging" && params["status"] !== "triaging") {
      return {
        success: false,
        error: "Use triage_backlog_item to leave triaging status",
        message: "Items in triaging must be moved out via triage_backlog_item so the decision is recorded with rationale.",
      };
    }
    data["status"] = params["status"];
    // Track completion date
    const isTerminal = params["status"] === "done" || params["status"] === "deferred";
    const wasTerminal = existing.status === "done" || existing.status === "deferred";
    if (isTerminal && !wasTerminal) {
      data["completedAt"] = new Date();
    } else if (!isTerminal && wasTerminal) {
      data["completedAt"] = null;
    }
  }
  if (typeof params["priority"] === "number") data["priority"] = params["priority"];
  if (typeof params["body"] === "string") data["body"] = params["body"];
  if (typeof params["workType"] === "string") data["workType"] = params["workType"];
  if (typeof params["source"] === "string") data["source"] = params["source"];
  if (typeof params["proposedOutcome"] === "string") data["proposedOutcome"] = params["proposedOutcome"];
  if (typeof params["scopeKind"] === "string") {
    const scopeKind = params["scopeKind"].trim();
    if (!(BACKLOG_SCOPE_KIND_VALUES as readonly string[]).includes(scopeKind)) {
      return {
        success: false,
        error: "invalid_scopeKind",
        message: `scopeKind must be one of ${BACKLOG_SCOPE_KIND_VALUES.join("|")}`,
      };
    }
    data["scopeKind"] = scopeKind;
  }
  const archetypeCategories = cleanStringArray(params["archetypeCategories"]);
  if (archetypeCategories) data["archetypeCategories"] = archetypeCategories;
  const archetypeIds = cleanStringArray(params["archetypeIds"]);
  if (archetypeIds) data["archetypeIds"] = archetypeIds;
  if (typeof params["scopeRationale"] === "string") data["scopeRationale"] = params["scopeRationale"].trim() || null;
  const lifecycleTags = cleanStringArray(params["lifecycleTags"]);
  if (lifecycleTags) data["lifecycleTags"] = lifecycleTags;

  // Structural portfolio association: accept the stable human ids and resolve to
  // the FK ids (BacklogItem.digitalProductId / taxonomyNodeId / portfolioId).
  let explicitPortfolio = false;
  let touchedLinks = false;
  if (typeof params["digitalProductId"] === "string") {
    const prod = await prisma.digitalProduct.findUnique({
      where: { productId: params["digitalProductId"] },
      select: { id: true },
    });
    if (!prod) return { success: false, error: "digital_product_not_found", message: `DigitalProduct ${params["digitalProductId"]} not found` };
    data["digitalProductId"] = prod.id;
    touchedLinks = true;
  }
  if (typeof params["taxonomyNodeId"] === "string") {
    const node = await prisma.taxonomyNode.findUnique({
      where: { nodeId: params["taxonomyNodeId"] },
      select: { id: true },
    });
    if (!node) return { success: false, error: "taxonomy_node_not_found", message: `TaxonomyNode ${params["taxonomyNodeId"]} not found` };
    data["taxonomyNodeId"] = node.id;
    touchedLinks = true;
  }
  if (typeof params["portfolioSlug"] === "string") {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: params["portfolioSlug"] },
      select: { id: true },
    });
    if (!portfolio) return { success: false, error: "portfolio_not_found", message: `Portfolio ${params["portfolioSlug"]} not found` };
    data["portfolioId"] = portfolio.id;
    explicitPortfolio = true;
  }

  await prisma.backlogItem.update({ where: { itemId: String(params["itemId"]) }, data });

  // When links changed and the portfolio wasn't explicitly pinned, re-derive the
  // denormalized portfolioId cache from the links (product -> taxonomy -> epic).
  let resolvedPortfolioId: string | null = null;
  if (touchedLinks && !explicitPortfolio) {
    resolvedPortfolioId = await attributeBacklogPortfolio(existing.id);
  } else if (explicitPortfolio) {
    resolvedPortfolioId = String(data["portfolioId"]);
  }

  return {
    success: true,
    entityId: String(params["itemId"]),
    message: `Updated ${String(params["itemId"])}`,
    ...(resolvedPortfolioId !== null ? { data: { portfolioId: resolvedPortfolioId } } : {}),
  };
}
