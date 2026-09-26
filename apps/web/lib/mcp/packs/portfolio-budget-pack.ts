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
import { quarterBounds } from "@/lib/portfolio/investment-points";
import {
  loadPortfolioBudgets,
  portfolioBudgetLabel,
  proposePortfolioBudgets,
  setPortfolioBudget,
} from "@/lib/portfolio/portfolio-budget";
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
  {
    name: "propose_portfolio_budgets",
    description:
      "Show each portfolio's current budget for a quarter (or 'No budget set', never zero) beside a proposal derived from the previous quarter's delivered points per portfolio, including the delivered points no portfolio can carry. Read-only: the proposal is never applied. Set a budget with set_portfolio_budget.",
    inputSchema: {
      type: "object",
      properties: {
        quarterOf: { type: "string", description: "ISO date inside the target quarter (UTC). Defaults to the current quarter." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "set_portfolio_budget",
    description:
      "Set one portfolio's budget for one quarter, in investment points, with an optional $ rate per point and an optional WIP allowance override. A reason is required and the setting person is recorded. A change never edits the old budget: it adds a row that supersedes it, so the history stays.",
    inputSchema: {
      type: "object",
      properties: {
        portfolioId: { type: "string", description: "Portfolio id, as returned by propose_portfolio_budgets." },
        quarterOf: { type: "string", description: "ISO date inside the target quarter (UTC). Defaults to the current quarter." },
        allocatedPoints: { type: "integer", description: "Budget in investment points (the 1/3/8/20 scale), zero or more." },
        usdPerPoint: { type: "number", description: "Optional dollars per point for this quarter." },
        wipAllowancePoints: { type: "integer", description: "Optional override of the points-in-flight allowance for this quarter." },
        reason: { type: "string", description: "Why this budget is right. Recorded on the row." },
      },
      required: ["portfolioId", "allocatedPoints", "reason"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

function targetQuarter(params: Record<string, unknown>) {
  const raw = typeof params["quarterOf"] === "string" ? new Date(params["quarterOf"]) : new Date();
  return quarterBounds(Number.isNaN(raw.getTime()) ? new Date() : raw);
}

async function proposePortfolioBudgetsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const period = targetQuarter(params);
  const [proposal, budgets] = await Promise.all([
    proposePortfolioBudgets(prisma as never, period),
    loadPortfolioBudgets(prisma as never, period),
  ]);
  const current = new Map(budgets.map((b) => [b.id, b.budget]));
  return {
    success: true,
    message: `${budgets.filter((b) => b.budget).length} of ${budgets.length} portfolio(s) have a budget for ${period.start.toISOString().slice(0, 10)}.`,
    data: {
      ...proposal,
      rows: proposal.rows.map((row) => ({
        ...row,
        currentBudget: current.get(row.id) ?? null,
        currentBudgetLabel: portfolioBudgetLabel(current.get(row.id) ?? null),
      })),
    },
  };
}

async function setPortfolioBudgetHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const optionalNumber = (value: unknown) => (typeof value === "number" ? value : null);
  const result = await setPortfolioBudget(prisma as never, {
    portfolioId: String(params["portfolioId"] ?? ""),
    period: targetQuarter(params),
    allocatedPoints: Number(params["allocatedPoints"]),
    usdPerPoint: optionalNumber(params["usdPerPoint"]),
    wipAllowancePoints: optionalNumber(params["wipAllowancePoints"]),
    reason: typeof params["reason"] === "string" ? params["reason"] : "",
    actor: { userId: userId || null, agentId: context?.agentId ?? null },
  });
  if (!result.ok) return { success: false, error: result.error, message: result.message };
  return { success: true, entityId: result.data.budgetId, message: "Portfolio budget set.", data: result.data };
}

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
    propose_portfolio_budgets: (params) => proposePortfolioBudgetsHandler(params),
    set_portfolio_budget: (params, userId, context) => setPortfolioBudgetHandler(params, userId, context),
  },
  grants: {
    propose_epic_portfolios: ["backlog_read"],
    confirm_epic_portfolios: ["backlog_write"],
    propose_portfolio_budgets: ["backlog_read"],
    set_portfolio_budget: ["backlog_write"],
  },
};
