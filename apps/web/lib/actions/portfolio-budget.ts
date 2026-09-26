"use server";

// Person-facing writes from the portfolio tie-out on Ops > Delivery Flow
// (BI-CBF5D708, carrying BI-9EC60FE0's budget and BI-A73A7DA3's epic
// attribution). Both go through the same functions as the MCP tools, so the
// refusals, the recorded reason and the named person are identical on both
// surfaces. The tie-out reports and steers; nothing here dispatches work.

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { ok, type ActionResult } from "@/lib/shared/action-result";
import { confirmEpicPortfolios } from "@/lib/portfolio/epic-portfolio-attribution";
import { quarterBounds } from "@/lib/portfolio/investment-points";
import { setPortfolioBudget } from "@/lib/portfolio/portfolio-budget";

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
