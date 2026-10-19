"use server";

// Person-facing writes from the portfolio tie-out on Ops > Delivery Flow
// (BI-CBF5D708, carrying BI-9EC60FE0's budget and BI-A73A7DA3's epic
// attribution). Both go through the same functions as the MCP tools, so the
// refusals, the recorded reason and the named person are identical on both
// surfaces. The tie-out reports and steers; nothing here dispatches work.

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { requireCapability } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { setPortfolioOwner } from "@/lib/portfolio/accountable-owner";
import { confirmEpicPortfolios } from "@/lib/portfolio/epic-portfolio-attribution";
import { quarterBounds } from "@/lib/portfolio/investment-points";
import { setPortfolioBudget } from "@/lib/portfolio/portfolio-budget";
import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import type { FundingScope } from "@/lib/portfolio/investment-balance-policy";
import type { BalancePolicy } from "@/lib/portfolio/investment-balance";
import { getT } from "@/lib/i18n/t.server";

async function runInvestmentTool(toolName: string, rawParams: Record<string, unknown>): Promise<ActionResult<string>> {
  const { userId, userContext } = await requireCapabilityContext("manage_backlog");
  const t = await getT("portfolio");
  const result = await governedExecuteTool({ toolName, rawParams, userId, userContext, context: { routeContext: "/ops/demand" }, source: "rest" });
  if (!result.success) return err(t(result.error === "stale-revision" || result.error === "stale-binding" ? "investment.concurrentChange" : result.error === "not-owner" || result.error === "unresolved-authority" ? "investment.ownerRequired" : "investment.saveFailed"));
  revalidatePath("/ops/demand");
  revalidatePath("/ops/installation");
  return ok(t("investment.saved"));
}

export async function saveInvestmentBalanceAction(input: { scope: FundingScope; policy: BalancePolicy; expectedRevision: string | null; reason: string }) {
  return runInvestmentTool("set_investment_balance", input);
}

export async function bindInstallationInvestmentAction(input: { scope: FundingScope; expectedBoundAt: string | null; reason: string }) {
  return runInvestmentTool("bind_investment_funding", { ...input, target: { kind: "installation", purpose: input.scope.purpose } });
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function setPortfolioBudgetAction(input: {
  portfolioId: string;
  allocatedPoints: number;
  reason: string;
}): Promise<ActionResult<string>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to set a portfolio budget." };
  const result = await setPortfolioBudget(prisma as never, {
    portfolioId: input.portfolioId,
    period: quarterBounds(new Date()),
    allocatedPoints: input.allocatedPoints,
    reason: input.reason,
    actor: { userId },
  });
  if (!result.ok) return { ok: false, error: result.message };
  revalidatePath("/ops/demand");
  return ok(`Budget set to ${input.allocatedPoints} points for this quarter.`);
}

export async function confirmEpicPortfoliosAction(input: {
  confirmations: Array<{ epicId: string; portfolioId: string }>;
  reason: string;
  batch?: "high";
}): Promise<ActionResult<string>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to confirm an epic's portfolio." };
  const result = await confirmEpicPortfolios(prisma as never, {
    confirmations: input.confirmations,
    reason: input.reason,
    actor: { userId },
    ...(input.batch ? { batch: input.batch } : {}),
  });
  if (!result.ok) return { ok: false, error: result.message };
  revalidatePath("/ops/demand");
  return ok(`Confirmed ${result.data.confirmed.length} epic(s); the reason is recorded with each.`);
}

/** Choose the one person who answers for a portfolio's automatic work (BI-67B27832). */
export async function setPortfolioOwnerAction(input: {
  portfolioId: string;
  principalRef: string | null;
  reason: string;
}): Promise<ActionResult<string>> {
  const { userId } = await requireCapability("manage_platform");
  const result = await setPortfolioOwner(prisma as never, { ...input, actor: { userId } });
  if (!result.ok) return err(result.message);
  revalidatePath("/ops/demand");
  return ok(result.data.accountablePrincipalId ? "Accountable person saved." : "Accountable person cleared.");
}
