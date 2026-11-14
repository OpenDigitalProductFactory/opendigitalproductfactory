// Human confirmation of statutory payroll figures (BI-8E1FD1BD).
//
// statutory-rules.ts holds the policy — what a proposal must carry, who may
// ratify, which rules resolve — and every function there is pure. What it never
// had was a caller a PERSON could reach. A coworker could propose a cited FICA
// rate; checkStatutoryRatification refused every agent; resolveStatutoryRule only
// returns ratified rules; and no page or action let a human ratify anything. So a
// perfect proposal could never reach a payroll. This module is that missing step,
// and the operator's direct-entry path beside it.
//
// The database is injected, so the rules here are tested without one.

import {
  checkStatutoryProposal,
  checkStatutoryRatification,
  rulesSupersededBy,
  type ResolvableStatutoryRule,
  type StatutoryProposalInput,
  type StatutoryRuleKind,
  type StatutoryRuleStatus,
  statutoryQualifierKey,
} from "./statutory-rules";
import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/**
 * Who is acting. The session email travels with the id because the platform's
 * automation persona signs a browser in with an ordinary session: an agent
 * driving the portal arrives here looking exactly like a person unless the
 * persona is checked. Treating it as human would let an agent ratify its own
 * proposal through the UI, and the propose/ratify split would be decorative.
 */
export interface StatutoryActor {
  userId: string;
  email: string | null;
}

export function statutoryActorKind(actor: StatutoryActor): "human" | "agent" {
  return isPlatformAutomationPersona(actor.email) ? "agent" : "human";
}

/** The row shape this module reads. A subset of PayrollTaxRule. */
export interface StatutoryRuleRow {
  id: string;
  payrollTaxRuleId: string;
  jurisdictionRefId: string;
  taxType: string;
  ruleKind: StatutoryRuleKind;
  side: string | null;
  taxYear: number;
  value: { toString(): string } | number;
  status: StatutoryRuleStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  sourceUrl: string | null;
  /** See ResolvableStatutoryRule.qualifierKey. Absent on rows read before BI-2BC8D614. */
  qualifierKey?: string;
}

export interface StatutoryRatificationDb {
  payrollTaxRule: {
    findUnique(args: unknown): Promise<StatutoryRuleRow | null>;
    findMany(args: unknown): Promise<StatutoryRuleRow[]>;
    create(args: unknown): Promise<StatutoryRuleRow>;
    update(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: StatutoryRatificationDb) => Promise<T>): Promise<T>;
}

/** The shared result primitive, so every finance surface reads one failure shape. */
export type StatutoryDecisionResult = ActionResult<{ payrollTaxRuleId: string; closedWindows: string[] }>;

function toResolvable(row: StatutoryRuleRow): ResolvableStatutoryRule {
  return {
    id: row.id,
    taxType: row.taxType,
    ruleKind: row.ruleKind,
    side: row.side,
    taxYear: row.taxYear,
    value: Number(row.value.toString()),
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    sourceUrl: row.sourceUrl,
    qualifierKey: row.qualifierKey ?? "",
  };
}

/**
 * Close the window of each earlier ratified figure the incoming one supersedes.
 *
 * The earlier rule stays RATIFIED. resolveStatutoryRule only ever returns
 * ratified rules, so marking it `superseded` would stop it governing its own
 * past dates and silently re-price every closed period that used it — the exact
 * thing rulesSupersededBy promises not to do. Closing effectiveTo at the new
 * rule's start keeps both answers correct: the old figure for the old dates, the
 * new one from here on.
 */
async function closeSupersededWindows(
  tx: StatutoryRatificationDb,
  incoming: StatutoryRuleRow,
): Promise<string[]> {
  const peers = await tx.payrollTaxRule.findMany({
    where: {
      jurisdictionRefId: incoming.jurisdictionRefId,
      taxType: incoming.taxType,
      ruleKind: incoming.ruleKind,
      side: incoming.side,
      qualifierKey: incoming.qualifierKey ?? "",
      status: "ratified",
    },
  });
  const superseded = rulesSupersededBy(toResolvable(incoming), peers.map(toResolvable));
  const closed: string[] = [];
  for (const rule of superseded) {
    // Only narrow a window, never widen one: an earlier rule that already ends
    // before the new one starts is left exactly as it was.
    if (rule.effectiveTo !== null && rule.effectiveTo.getTime() <= incoming.effectiveFrom.getTime()) {
      continue;
    }
    await tx.payrollTaxRule.update({
      where: { id: rule.id },
      data: { effectiveTo: incoming.effectiveFrom },
    });
    closed.push(rule.id);
  }
  return closed;
}

async function ratifyRow(
  tx: StatutoryRatificationDb,
  row: StatutoryRuleRow,
  actor: StatutoryActor,
  now: Date,
): Promise<StatutoryDecisionResult> {
  const check = checkStatutoryRatification(toResolvable(row), { kind: statutoryActorKind(actor) });
  if (!check.valid) return err(check.detail);
  const closedWindows = await closeSupersededWindows(tx, row);
  await tx.payrollTaxRule.update({
    where: { id: row.id },
    data: { status: "ratified", ratifiedByUserId: actor.userId, ratifiedAt: now },
  });
  return ok({ payrollTaxRuleId: row.payrollTaxRuleId, closedWindows });
}

/** A person confirms a proposed figure. */
export async function ratifyStatutoryRule(
  db: StatutoryRatificationDb,
  input: { payrollTaxRuleId: string; actor: StatutoryActor; now: Date },
): Promise<StatutoryDecisionResult> {
  return db.$transaction(async (tx) => {
    const row = await tx.payrollTaxRule.findUnique({
      where: { payrollTaxRuleId: input.payrollTaxRuleId },
    });
    if (!row) return err("No statutory figure with that id.");
    return ratifyRow(tx, row, input.actor, input.now);
  });
}

/**
 * A person declines a proposed figure. The reason is required and kept: a
 * rejection with no explanation tells the coworker nothing about what to go
 * and find instead.
 */
export async function rejectStatutoryRule(
  db: StatutoryRatificationDb,
  input: { payrollTaxRuleId: string; actor: StatutoryActor; reason: string; now: Date },
): Promise<StatutoryDecisionResult> {
  // Rejecting is a decision about a figure too. The same automation-persona
  // check applies, so an agent cannot clear a rival proposal out of its way.
  if (statutoryActorKind(input.actor) !== "human") {
    return err("only a person can reject a statutory figure");
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return err("Say why — a rejection with no reason gives the researcher nothing to correct.");
  }
  return db.$transaction(async (tx) => {
    const row = await tx.payrollTaxRule.findUnique({
      where: { payrollTaxRuleId: input.payrollTaxRuleId },
    });
    if (!row) return err("No statutory figure with that id.");
    if (row.status !== "proposed") {
      return err(`only a proposed figure can be rejected; this one is "${row.status}"`);
    }
    await tx.payrollTaxRule.update({
      where: { id: row.id },
      data: { status: "rejected", rejectedReason: reason.slice(0, 2_000) },
    });
    return ok({ payrollTaxRuleId: row.payrollTaxRuleId, closedWindows: [] });
  });
}

/**
 * A person records a figure they have read themselves, and confirms it.
 *
 * The coworker path is the intended one, but a payroll must not depend on it:
 * an install whose research coworker is unreachable would otherwise have no way
 * to put a single figure in place. This runs the SAME proposal check a coworker
 * faces — no citation, no record — and then the same ratification check, so the
 * operator path is not a lower bar, only a shorter route. proposedByAgentId stays
 * null, which is how the schema already marks an operator-entered figure.
 */
export async function recordAndRatifyStatutoryRule(
  db: StatutoryRatificationDb,
  input: {
    proposal: Omit<StatutoryProposalInput, "proposedByAgentId">;
    actor: StatutoryActor;
    payrollTaxRuleId: string;
    now: Date;
  },
): Promise<StatutoryDecisionResult> {
  if (statutoryActorKind(input.actor) !== "human") {
    return err("only a person can enter a statutory figure directly");
  }
  const proposal = { ...input.proposal, proposedByAgentId: null };
  const check = checkStatutoryProposal(proposal);
  if (!check.valid) return err(check.detail);
  if (!proposal.sourceExcerpt || proposal.sourceExcerpt.trim().length === 0) {
    // checkStatutoryProposal does not require the excerpt, because a coworker's
    // proposal is reviewed afterwards by someone who can open the source. Here
    // the reviewer and the author are the same person in the same moment, so the
    // quoted passage is the only record of what they read.
    return err("Quote the passage that states the figure; without it nobody can later check what was read.");
  }
  return db.$transaction(async (tx) => {
    const created = await tx.payrollTaxRule.create({
      data: {
        payrollTaxRuleId: input.payrollTaxRuleId,
        jurisdictionRefId: proposal.jurisdictionRefId,
        taxType: proposal.taxType,
        ruleKind: proposal.ruleKind,
        side: proposal.side ?? null,
        taxYear: proposal.taxYear,
        value: proposal.value,
        currency: proposal.currency ?? null,
        qualifiers: proposal.qualifiers ?? {},
        qualifierKey: statutoryQualifierKey(proposal.qualifiers),
        effectiveFrom: proposal.effectiveFrom,
        effectiveTo: proposal.effectiveTo ?? null,
        status: "proposed",
        sourceUrl: proposal.sourceUrl,
        sourceExcerpt: proposal.sourceExcerpt,
        retrievedAt: proposal.retrievedAt,
        proposedByAgentId: null,
        proposedAt: input.now,
        notes: proposal.notes ?? null,
      },
    });
    return ratifyRow(tx, created, input.actor, input.now);
  });
}

// ── Withholding tables (BI-099EAE30) ─────────────────────────────────────────
// An IRS Annual Percentage Method table is several figures that only mean
// something together: a table missing its top rows would quietly under-withhold
// every high earner. So a table is entered and confirmed in ONE transaction,
// each row at the same citation bar as a single figure, and any refused row
// rolls the whole table back.

export interface WithholdingTableEntry {
  jurisdictionRefId: string;
  filingStatus: "single" | "married_jointly" | "head_of_household";
  schedule: "standard" | "step2";
  taxYear: number;
  effectiveFrom: Date;
  sourceUrl: string;
  sourceExcerpt: string;
  retrievedAt: Date;
  /** Rows as the IRS prints them: wages over `over` taxed at `rate` (a fraction). */
  rows: ReadonlyArray<{ over: number; rate: number }>;
  /** Worksheet 1A line 1g for this filing status, when entering the standard table. */
  line1g?: number | null;
}

class TableRefused extends Error {}

export async function recordAndRatifyWithholdingTable(
  db: StatutoryRatificationDb,
  input: { entry: WithholdingTableEntry; actor: StatutoryActor; now: Date; idSeed: string },
): Promise<ActionResult<{ created: number }>> {
  const { entry, actor, now } = input;
  if (statutoryActorKind(actor) !== "human") return err("only a person can enter a statutory figure directly");
  if (!entry.sourceExcerpt.trim()) {
    return err("Quote the passage or table that states these figures; without it nobody can later check what was read.");
  }
  const rows = [...entry.rows];
  if (rows.length === 0) return err("Enter at least one row of the table.");
  if (rows[0]!.over !== 0) return err("A table starts with the row for wages over 0.");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!Number.isFinite(r.over) || r.over < 0 || !Number.isFinite(r.rate) || r.rate < 0 || r.rate >= 1) {
      return err(`Row ${i + 1} is not a wage amount and a percentage below 100.`);
    }
    if (i > 0 && r.over <= rows[i - 1]!.over) return err("Each row must start above the one before it.");
  }

  const base = {
    jurisdictionRefId: entry.jurisdictionRefId,
    taxType: "federal_withholding",
    taxYear: entry.taxYear,
    effectiveFrom: entry.effectiveFrom,
    effectiveTo: null,
    sourceUrl: entry.sourceUrl,
    sourceExcerpt: entry.sourceExcerpt,
    retrievedAt: entry.retrievedAt,
    proposedByAgentId: null,
    notes: null,
  };
  const proposals = [
    ...rows.map((r) => ({
      ...base, ruleKind: "rate" as const, side: "employee_withheld", value: r.rate, currency: null,
      qualifiers: { filingStatus: entry.filingStatus, schedule: entry.schedule, over: r.over },
    })),
    ...(entry.line1g != null
      ? [{
          ...base, ruleKind: "amount" as const, side: null, value: entry.line1g, currency: "USD",
          qualifiers: { line: "1g", filingStatus: entry.filingStatus === "married_jointly" ? "married_jointly" : "other" },
        }]
      : []),
  ];
  for (const proposal of proposals) {
    const check = checkStatutoryProposal(proposal);
    if (!check.valid) return err(check.detail);
  }

  try {
    await db.$transaction(async (tx) => {
      for (const [i, proposal] of proposals.entries()) {
        const created = await tx.payrollTaxRule.create({
          data: {
            ...proposal,
            payrollTaxRuleId: `PTR-${input.idSeed}-${i}`,
            qualifierKey: statutoryQualifierKey(proposal.qualifiers),
            status: "proposed",
            proposedAt: now,
          },
        });
        const ratified = await ratifyRow(tx, created, actor, now);
        if (!ratified.ok) throw new TableRefused(ratified.error);
      }
    });
  } catch (error) {
    if (error instanceof TableRefused) return err(error.message);
    throw error;
  }
  return ok({ created: proposals.length });
}
