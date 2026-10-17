// Portfolio budget tool pack (EP-PORTFOLIO-BUDGET-WIP).
//
// The governed MCP doors for portfolio attribution and budgets. Slice 2
// (BI-A73A7DA3): propose a portfolio for every epic, and confirm proposals
// through a write that records the confirming person and reason. Grants mirror
// tak/agent-grants.ts TOOL_TO_GRANTS; tool-registry.test asserts no drift.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { prisma } from "@dpf/db";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import {
  confirmEpicPortfolios,
  loadEpicPortfolioProposals,
  type EpicPortfolioConfirmation,
} from "@/lib/portfolio/epic-portfolio-attribution";
import { quarterBounds } from "@/lib/portfolio/investment-points";
import {
  loadPortfolioBudgets,
  portfolioBudgetLabel,
  proposalReason,
  proposePortfolioBudgets,
  resolveProposalBasis,
  setPortfolioBudget,
} from "@/lib/portfolio/portfolio-budget";
import { setPortfolioOwner } from "@/lib/portfolio/accountable-owner";
import type { ToolPack } from "../tool-pack";
import { isRecord } from "@/lib/shared/coerce";
import { parseFundingScope } from "@/lib/portfolio/investment-balance-binding";
import { validateBalancePolicy } from "@/lib/portfolio/investment-balance";

const fundingScopeSchema = {
  type: "object", additionalProperties: false,
  properties: { principalId: { type: "string" }, organizationId: { type: "string" }, purpose: { type: "string", enum: ["shared-platform", "archetype"] } },
  required: ["principalId", "organizationId", "purpose"],
};
const balancePolicySchema = {
  type: "object", additionalProperties: false,
  properties: {
    refactorPercent: { type: "integer", minimum: 0, maximum: 100 },
    windowDays: { type: "integer", minimum: 1, maximum: 180 },
    tolerancePercent: { type: "integer", minimum: 0, maximum: 20 },
    steeringEnabled: { type: "boolean" }, minimumAttempts: { type: "integer", minimum: 1 },
    minimumTokens: { type: "integer", minimum: 1 }, minimumClassificationPercent: { type: "integer", minimum: 1, maximum: 100 },
    freshnessDays: { type: "integer", minimum: 1, maximum: 180 },
  },
  required: ["refactorPercent", "windowDays", "tolerancePercent", "steeringEnabled", "minimumAttempts", "minimumTokens", "minimumClassificationPercent", "freshnessDays"],
};

const definitions: ToolDefinition[] = [
  {
    name: "get_investment_balance",
    description: "Read your funding scope's cumulative refactor/new target, revision and measured token coverage. Founder shared platform defaults to 80% refactor; organization/archetype work defaults to 20%. Unobserved external spending is not estimated. Requires the recorded funding owner; an admin role does not substitute.",
    inputSchema: { type: "object", properties: { scope: fundingScopeSchema }, required: ["scope"] },
    requiredCapability: "view_operations", executionMode: "immediate", sideEffect: false,
  },
  {
    name: "set_investment_balance",
    description: "Set your scope's approximate cumulative refactor/new target and optional dynamic steering. Read the current revision first, then provide expectedRevision (null for first setup) and a reason. Canonical funding authority is checked in the transaction. Revisions preserve history; hard spend, readiness and WIP limits remain in force.",
    inputSchema: { type: "object", properties: { scope: fundingScopeSchema, policy: balancePolicySchema, expectedRevision: { type: ["string", "null"] }, reason: { type: "string" }, expiresAt: { type: ["string", "null"] } }, required: ["scope", "policy", "expectedRevision", "reason"] },
    requiredCapability: "manage_backlog", sideEffect: true, consequence: "authority",
  },
  {
    name: "bind_investment_funding",
    description: "Explicitly bind your funding scope to this installation, your organization's work in a portfolio, or an admitted Workroom item. Portfolio management does not transfer funding authority. A Workroom itemId of * is its default; specific items override it and may carry an evidenced refactor/new classification. Bindings never follow coordinator changes or copied installation identity. Requires expectedBoundAt (null for first setup) and a reason. A successor is allowed only after the former owner loses recorded funding authority; history stays unchanged.",
    inputSchema: { type: "object", properties: {
      scope: fundingScopeSchema, expectedBoundAt: { type: ["string", "null"] }, reason: { type: "string" }, classification: { type: ["string", "null"], enum: ["refactor", "new", null], description: "Optional evidenced classification for one specific Workroom item. Explain in reason. Null clears the override; omit to preserve it." },
      target: { type: "object", properties: { kind: { type: "string", enum: ["installation", "portfolio", "workroom"] }, id: { type: "string" }, purpose: { type: "string", enum: ["shared-platform", "archetype"] }, itemId: { type: "string" } }, required: ["kind"] },
    }, required: ["scope", "target", "expectedBoundAt", "reason"] },
    requiredCapability: "manage_backlog", sideEffect: true, consequence: "authority",
  },
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
      "Show each portfolio's current budget for a quarter (or 'No budget set', never zero) beside a proposal derived from delivered points per portfolio, including the delivered points no portfolio can carry. Platform or common work with no explicit portfolio counts as Foundational; each row's attributedByRule (basis platform-default) shows how much of it came from that rule. The basis is the previous quarter by default; with trailingDays it is the last N days of delivery, scaled to the target quarter's length (use this for a first quarter, e.g. trailingDays 90). The response carries suggestedReason, which labels a trailing-window proposal provisional and revisable. Read-only: the proposal is never applied. A person applies or edits each figure with set_portfolio_budget.",
    inputSchema: {
      type: "object",
      properties: {
        quarterOf: { type: "string", description: "ISO date inside the target quarter (UTC). Defaults to the current quarter." },
        trailingDays: { type: "integer", description: "Optional: propose from points delivered in the last N days (1-366) instead of the previous quarter, scaled to the target quarter's length." },
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
  // BI-67B27832: one accountable person per portfolio owns its automatic work.
  {
    name: "set_portfolio_owner",
    description:
      "Set or clear the one person accountable for a portfolio. That person owns the portfolio's automatic work: scheduled builds, the rooms they open, and the approvals they raise. Only an active person with an active account can be chosen, never a coworker. A reason is required and the setting person is recorded. Pass principalRef null to clear; automatic work then falls to the Foundational owner, then the organization's top accountable.",
    inputSchema: {
      type: "object",
      properties: {
        portfolioId: { type: "string", description: "Portfolio id, as returned by propose_portfolio_budgets." },
        principalRef: { type: ["string", "null"], description: "The person's principal id (PRN-*), or null to clear." },
        reason: { type: "string", description: "Why this person answers for the portfolio. Recorded with it." },
      },
      required: ["portfolioId", "principalRef", "reason"],
    },
    requiredCapability: "manage_platform",
    sideEffect: true,
    // Changes who decides the approvals this portfolio's work raises.
    consequence: "authority",
  },
];

function targetQuarter(params: Record<string, unknown>) {
  const raw = typeof params["quarterOf"] === "string" ? new Date(params["quarterOf"]) : new Date();
  return quarterBounds(Number.isNaN(raw.getTime()) ? new Date() : raw);
}

async function proposePortfolioBudgetsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const period = targetQuarter(params);
  const options = params["trailingDays"] === undefined || params["trailingDays"] === null
    ? {}
    : { trailingDays: Number(params["trailingDays"]), asOf: new Date() };
  const basis = resolveProposalBasis(period, options);
  if (!basis.ok) return { success: false, error: basis.error, message: basis.message };
  const [proposal, budgets] = await Promise.all([
    proposePortfolioBudgets(prisma as never, period, options),
    loadPortfolioBudgets(prisma as never, period),
  ]);
  const current = new Map(budgets.map((b) => [b.id, b.budget]));
  return {
    success: true,
    message: `${budgets.filter((b) => b.budget).length} of ${budgets.length} portfolio(s) have a budget for ${period.start.toISOString().slice(0, 10)}.`,
    data: {
      ...proposal,
      suggestedReason: proposalReason(proposal),
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

async function setPortfolioOwnerHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const principalRef = typeof params["principalRef"] === "string" && params["principalRef"].trim()
    ? params["principalRef"].trim()
    : null;
  const result = await setPortfolioOwner(prisma as never, {
    portfolioId: String(params["portfolioId"] ?? ""),
    principalRef,
    reason: typeof params["reason"] === "string" ? params["reason"] : "",
    actor: { userId: userId || null },
  });
  if (!result.ok) return { success: false, error: result.error, message: result.message };
  return {
    success: true,
    entityId: result.data.portfolioId,
    message: result.data.accountablePrincipalId ? "Portfolio owner set." : "Portfolio owner cleared.",
    data: result.data,
  };
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

async function investmentHandler(operation: "read" | "save" | "bind", params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): Promise<ToolResult> {
  const scope = parseFundingScope(params.scope);
  const invalid = { success: false, error: "invalid-investment-input", message: "Provide a funding scope and valid policy or binding fields, including the expected revision and reason for changes." };
  if (!scope || !userId) return invalid;
  if (operation === "save") {
    if (!validateBalancePolicy(params.policy) || !(params.expectedRevision === null || typeof params.expectedRevision === "string")
      || typeof params.reason !== "string" || !(params.expiresAt === undefined || params.expiresAt === null || typeof params.expiresAt === "string")) return invalid;
    const { saveScopedBalancePolicy } = await import("@/lib/portfolio/investment-balance-server");
    const result = await saveScopedBalancePolicy(prisma, { userId, scope, policy: params.policy, expectedRevision: params.expectedRevision, reason: params.reason, expiresAt: params.expiresAt });
    return result.ok ? { success: true, message: "Investment allocation saved.", data: result.data } : { success: false, error: result.error, message: "Investment allocation was not changed." };
  }
  if (operation === "bind") {
    const target = params.target;
    if (params.classification !== undefined && params.classification !== null && params.classification !== "refactor" && params.classification !== "new") return invalid;
    if (!isRecord(target) || typeof params.reason !== "string" || !(params.expectedBoundAt === null || typeof params.expectedBoundAt === "string")) return invalid;
    let typedTarget: import("@/lib/portfolio/investment-balance-server").FundingTarget;
    if (target.kind === "workroom" && typeof target.id === "string" && target.id && typeof target.itemId === "string" && target.itemId)
      typedTarget = { kind: "workroom", id: target.id, itemId: target.itemId };
    else if ((target.purpose === "shared-platform" || target.purpose === "archetype") && target.kind === "installation")
      typedTarget = { kind: "installation", purpose: target.purpose };
    else if ((target.purpose === "shared-platform" || target.purpose === "archetype") && target.kind === "portfolio" && typeof target.id === "string" && target.id)
      typedTarget = { kind: "portfolio", id: target.id, purpose: target.purpose };
    else return invalid;
    const { bindInvestmentFunding } = await import("@/lib/portfolio/investment-balance-server");
    const result = await bindInvestmentFunding(prisma, { userId, agentId: context?.agentId, scope, target: typedTarget, expectedBoundAt: params.expectedBoundAt, reason: params.reason, classification: params.classification });
    return result.ok ? { success: true, message: "Funding scope bound.", data: result.data } : { success: false, error: result.error, message: "Funding scope was not changed." };
  }
  const { resolvePrincipalRecordIdForSessionIdentity } = await import("@/lib/identity/principal-linking");
  const actor = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: userId });
  if (actor !== scope.principalId) return { success: false, error: "not-owner", message: "Only the funding owner can read this allocation report." };
  const { loadScopedBalanceReport } = await import("@/lib/portfolio/investment-balance-server");
  const resolved = await loadScopedBalanceReport(prisma, scope);
  if (!resolved.ok) return { success: false, error: resolved.error, message: "Funding authority or policy is unresolved." };
  return { success: true, message: "Investment allocation loaded.", data: resolved.data };
}

export const portfolioBudgetPack: ToolPack = {
  packId: "portfolio-budget",
  definitions,
  handlers: {
    get_investment_balance: (params, userId) => investmentHandler("read", params, userId),
    set_investment_balance: (params, userId) => investmentHandler("save", params, userId),
    bind_investment_funding: (params, userId, context) => investmentHandler("bind", params, userId, context),
    propose_epic_portfolios: (params) => proposeEpicPortfoliosHandler(params),
    confirm_epic_portfolios: (params, userId, context) => confirmEpicPortfoliosHandler(params, userId, context),
    propose_portfolio_budgets: (params) => proposePortfolioBudgetsHandler(params),
    set_portfolio_budget: (params, userId, context) => setPortfolioBudgetHandler(params, userId, context),
    set_portfolio_owner: (params, userId) => setPortfolioOwnerHandler(params, userId),
  },
  grants: {
    get_investment_balance: ["backlog_read"],
    set_investment_balance: ["backlog_write"],
    bind_investment_funding: ["backlog_write"],
    propose_epic_portfolios: ["backlog_read"],
    confirm_epic_portfolios: ["backlog_write"],
    propose_portfolio_budgets: ["backlog_read"],
    set_portfolio_budget: ["backlog_write"],
    set_portfolio_owner: ["backlog_write"],
  },
};
