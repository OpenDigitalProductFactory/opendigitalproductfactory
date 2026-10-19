"use server";

// BI-45D3BBF4: operator actions that grant and revoke the acceptance sweep's
// pre-authorisation to close items whose completion gate already allows done.
//
// Restricted to an operator who holds manage_platform (an operator setting)
// AND manage_backlog (every closure runs in this operator's human context, and
// the sweep re-checks that capability at each run).

import { prisma } from "@dpf/db";

import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import { mayManageCloseAuthorisation } from "@/lib/backlog/acceptance-sweep/close-authorisation-access";
import { writeCloseAuthorisation, type CloseAuthorisationWriterDb } from "@/lib/backlog/acceptance-sweep/close-authorisation-writer";
import type { CloseAuthorisationRecord } from "@/lib/backlog/acceptance-sweep/close-authorisation";
import { err, type ActionResult } from "@/lib/shared/action-result";

async function requireOperator(): Promise<{ userId: string } | null> {
  const { userId, userContext } = await requireCapabilityContext("manage_platform");
  return mayManageCloseAuthorisation(userContext) ? { userId } : null;
}

export async function grantAcceptanceSweepCloseAuthorisation(input: {
  reason: string;
  maxClosuresPerRun?: number;
}): Promise<ActionResult<CloseAuthorisationRecord>> {
  const operator = await requireOperator();
  if (!operator) return err("Granting this needs both manage_platform and manage_backlog.");
  return writeCloseAuthorisation(prisma as unknown as CloseAuthorisationWriterDb, {
    action: "grant",
    userId: operator.userId,
    reason: input.reason,
    now: new Date(),
    ...(input.maxClosuresPerRun !== undefined ? { maxClosuresPerRun: input.maxClosuresPerRun } : {}),
  });
}

export async function revokeAcceptanceSweepCloseAuthorisation(input: {
  reason: string;
}): Promise<ActionResult<CloseAuthorisationRecord>> {
  const operator = await requireOperator();
  if (!operator) return err("Revoking this needs both manage_platform and manage_backlog.");
  return writeCloseAuthorisation(prisma as unknown as CloseAuthorisationWriterDb, {
    action: "revoke",
    userId: operator.userId,
    reason: input.reason,
    now: new Date(),
  });
}
