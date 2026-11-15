"use server";

// Server actions for confirming statutory payroll figures (BI-8E1FD1BD).
//
// Thin wrappers over lib/finance/statutory-ratification.ts, which holds the
// rules. Per AGENTS.md §6 this module exports functions only.
//
// SECURITY: the actor is resolved from the SESSION, never from client input, and
// the session email travels with it so the automation persona — an agent signed
// into a browser with an ordinary session — is recognised and refused. Accepting
// an actor from the caller would let anything that can post to this action claim
// to be a person, which is the one thing the propose/ratify split exists to stop.

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { newId } from "@/lib/shared/new-id";
import {
  ratifyStatutoryRule,
  recordAndRatifyStatutoryRule,
  rejectStatutoryRule,
  type StatutoryRatificationDb,
} from "@/lib/finance/statutory-ratification";
import type { StatutoryRuleKind } from "@/lib/finance/statutory-rules";

const STATUTORY_RATES_PATH = "/finance/settings/statutory-rates";

async function sessionActor() {
  const { userId, email } = await requireCapabilityContext("manage_finance");
  return { userId, email };
}

const db = prisma as unknown as StatutoryRatificationDb;

export async function ratifyStatutoryRuleAction(
  payrollTaxRuleId: string,
): Promise<ActionResult<{ payrollTaxRuleId: string }>> {
  const actor = await sessionActor();
  const result = await ratifyStatutoryRule(db, { payrollTaxRuleId, actor, now: new Date() });
  if (!result.ok) return err(result.error);
  revalidatePath(STATUTORY_RATES_PATH);
  return ok({ payrollTaxRuleId: result.data.payrollTaxRuleId });
}

export async function rejectStatutoryRuleAction(
  payrollTaxRuleId: string,
  reason: string,
): Promise<ActionResult<{ payrollTaxRuleId: string }>> {
  const actor = await sessionActor();
  const result = await rejectStatutoryRule(db, { payrollTaxRuleId, actor, reason, now: new Date() });
  if (!result.ok) return err(result.error);
  revalidatePath(STATUTORY_RATES_PATH);
  return ok({ payrollTaxRuleId: result.data.payrollTaxRuleId });
}

export async function recordStatutoryRuleAction(input: {
  jurisdictionRefId: string;
  taxType: string;
  ruleKind: StatutoryRuleKind;
  side: string | null;
  taxYear: number;
  value: number;
  currency: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string;
  sourceExcerpt: string;
  retrievedAt: string;
  notes: string | null;
}): Promise<ActionResult<{ payrollTaxRuleId: string }>> {
  const actor = await sessionActor();
  const payrollTaxRuleId = `PTR-${newId().slice(0, 12).toUpperCase()}`;
  const result = await recordAndRatifyStatutoryRule(db, {
    actor,
    payrollTaxRuleId,
    now: new Date(),
    proposal: {
      jurisdictionRefId: input.jurisdictionRefId,
      taxType: input.taxType,
      ruleKind: input.ruleKind,
      side: input.side,
      taxYear: input.taxYear,
      value: input.value,
      currency: input.currency,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      sourceUrl: input.sourceUrl,
      sourceExcerpt: input.sourceExcerpt,
      retrievedAt: new Date(input.retrievedAt),
      notes: input.notes,
    },
  });
  if (!result.ok) return err(result.error);
  revalidatePath(STATUTORY_RATES_PATH);
  return ok({ payrollTaxRuleId: result.data.payrollTaxRuleId });
}
