// Portfolio budget tool pack (EP-PORTFOLIO-BUDGET-WIP).
//
// The governed MCP doors for portfolio attribution and budgets. Slice 2
// (BI-A73A7DA3): propose a portfolio for every epic, and confirm proposals
// through a write that records the confirming person and reason. Grants mirror
// tak/agent-grants.ts TOOL_TO_GRANTS; tool-registry.test asserts no drift.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { prisma } from "@dpf/db";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";
import {
  confirmEpicPortfolios,
  loadEpicPortfolioProposals,
  type EpicPortfolioConfirmation,
} from "@/lib/portfolio/epic-portfolio-attribution";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "propose_epic_portfolios",
    description:
      "Propose a portfolio for every epic from its own items' links, with evidence and a confidence of high or low. High means one portfolio holds at least 80% of three or more attributed items; otherwise a text match against the portfolio vocabulary is added as evidence and the proposal is low. Read-only: proposals are never applied. Confirm with confirm_epic_portfolios.",
    inputSchema: {
      type: "object",
      properties: {
        onlyUnconfirmed: { type: "boolean", description: "Only epics with no confirmed attribution (default true)." },
        confidence: { type: "string", enum: ["high", "low"], description: "Only proposals of this confidence." },
        limit: { type: "number", description: "Max proposals (default 100, max 500). The response reports total and truncated." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "confirm_epic_portfolios",
    description:
      "Confirm an epic's portfolio attribution. Records the confirming person, the reason, and the proposal's confidence on the EpicPortfolio row, replaces the epic's previous attribution, and refreshes its items' portfolio. A reason is required. With batch=high, every epic must still be a high-confidence proposal for exactly the named portfolio, or nothing is written; confirm low-confidence epics one at a time.",
    inputSchema: {
      type: "object",
      properties: {
        confirmations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              epicId: { type: "string", description: "Semantic epic id (EP-*)." },
              portfolioId: { type: "string", description: "Portfolio id, as returned by propose_epic_portfolios." },
            },
            required: ["epicId", "portfolioId"],
          },
          description: "The epics to confirm, each with the portfolio the person chose.",
        },
        reason: { type: "string", description: "Why this attribution is right. Recorded on every confirmed row." },
        batch: { type: "string", enum: ["high"], description: "Confirm only high-confidence proposals in one call." },
      },
      required: ["confirmations", "reason"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

async function proposeEpicPortfoliosHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const onlyUnconfirmed = params["onlyUnconfirmed"] !== false;
  const confidence = params["confidence"] === "high" || params["confidence"] === "low" ? params["confidence"] : null;
  const limit = Math.min(Math.max(Number(params["limit"]) || 100, 1), 500);
  const all = await loadEpicPortfolioProposals(prisma as never);
  const matching = all.filter((p) =>
    (!onlyUnconfirmed || !p.current.some((c) => c.confirmedAt !== null))
    && (confidence === null || p.confidence === confidence));
  return {
    success: true,
    message: `${matching.length} epic proposal(s); ${matching.filter((p) => p.confidence === "high").length} high confidence.`,
    data: { total: matching.length, truncated: matching.length > limit, proposals: matching.slice(0, limit) },
  };
}

async function confirmEpicPortfoliosHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const raw = Array.isArray(params["confirmations"]) ? params["confirmations"] : [];
  const confirmations: EpicPortfolioConfirmation[] = raw
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({ epicId: String(c["epicId"] ?? ""), portfolioId: String(c["portfolioId"] ?? "") }));
  const result = await confirmEpicPortfolios(prisma as never, {
    confirmations,
    reason: typeof params["reason"] === "string" ? params["reason"] : "",
    actor: { userId: userId || null, agentId: context?.agentId ?? null },
    ...(params["batch"] === "high" ? { batch: "high" as const } : {}),
  });
  if (!result.ok) return { success: false, error: result.error, message: result.message };
  return {
    success: true,
    message: `Confirmed ${result.data.confirmed.length} epic attribution(s).`,
    data: { confirmed: result.data.confirmed },
  };
}

export const portfolioBudgetPack: ToolPack = {
  packId: "portfolio-budget",
  definitions,
  handlers: {
    propose_epic_portfolios: (params) => proposeEpicPortfoliosHandler(params),
    confirm_epic_portfolios: (params, userId, context) => confirmEpicPortfoliosHandler(params, userId, context),
  },
  grants: {
    propose_epic_portfolios: ["backlog_read"],
    confirm_epic_portfolios: ["backlog_write"],
  },
};
