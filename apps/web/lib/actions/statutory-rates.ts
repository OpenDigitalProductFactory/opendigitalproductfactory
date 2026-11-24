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
  recordAndRatifyWithholdingTable,
  rejectStatutoryRule,
  type StatutoryRatificationDb,
} from "@/lib/finance/statutory-ratification";
import type { StatutoryRuleKind } from "@/lib/finance/statutory-rules";
import { parseWithholdingTableText } from "@/lib/finance/withholding-table-text";

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

/**
 * Enter and confirm a whole IRS withholding table read by a person
 * (BI-099EAE30). All rows are confirmed together or none are.
 */
export async function recordWithholdingTableAction(input: {
  jurisdictionRefId: string;
  filingStatus: string;
  schedule: string;
  taxYear: number;
  effectiveFrom: string;
  retrievedAt: string;
  sourceUrl: string;
  sourceExcerpt: string;
  rowsText: string;
  line1g: string;
}): Promise<ActionResult<{ created: number }>> {
  const actor = await sessionActor();
  const statuses = ["single", "married_jointly", "head_of_household"] as const;
  const filingStatus = statuses.find((s) => s === input.filingStatus);
  const schedule = input.schedule === "step2" ? "step2" : input.schedule === "standard" ? "standard" : null;
  if (!filingStatus || !schedule) return err("Choose the filing status and which table this is.");
  const parsed = parseWithholdingTableText(input.rowsText);
  if (!parsed.readable) return err(`Line ${parsed.line} is not a wage amount followed by a rate.`);
  const line1g = input.line1g.trim() === "" ? null : Number(input.line1g.replace(/[$,]/g, ""));
  if (line1g !== null && (!Number.isFinite(line1g) || line1g < 0)) return err("Enter the line 1g amount as a dollar figure, or leave it blank.");

  const result = await recordAndRatifyWithholdingTable(db, {
    actor,
    now: new Date(),
    idSeed: newId().slice(0, 10).toUpperCase(),
    entry: {
      jurisdictionRefId: input.jurisdictionRefId,
      filingStatus,
      schedule,
      taxYear: input.taxYear,
      effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
      retrievedAt: new Date(`${input.retrievedAt}T00:00:00.000Z`),
      sourceUrl: input.sourceUrl.trim(),
      sourceExcerpt: input.sourceExcerpt.trim(),
      rows: parsed.rows,
      line1g,
    },
  });
  if (result.ok) revalidatePath(STATUTORY_RATES_PATH);
  return result;
}
