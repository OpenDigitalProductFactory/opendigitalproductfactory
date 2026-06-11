"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireManageCompliance } from "./compliance-helpers";

// BI-AFC178F3 — member equity & patronage actions for member-owned archetypes.
// Conventions mirror lib/actions/civic-governance.ts.

export type MemberEquityActionResult = { ok: boolean; message: string };

const ENTRY_KINDS = [
  "patronage-allocation",
  "equity-retirement",
  "per-unit-retain",
  "adjustment",
] as const;

export type MemberEquityEntryKind = (typeof ENTRY_KINDS)[number];

/** Subchapter T floor: qualified allocations must pay at least 20% in cash. */
const QUALIFIED_CASH_FLOOR = 0.2;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function getCurrentOrgId(): Promise<string> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("No organization found");
  return org.id;
}

export async function recordEquityEntry(input: {
  memberAccountId: string;
  fiscalYear: number;
  kind: string;
  amount: number;
  qualified?: boolean;
  cashPortion?: number;
  notes?: string;
}): Promise<MemberEquityActionResult> {
  await requireManageCompliance();
  try {
    if (!ENTRY_KINDS.includes(input.kind as MemberEquityEntryKind)) {
      return { ok: false, message: `Invalid entry kind: ${input.kind}` };
    }
    if (!Number.isFinite(input.amount) || input.amount === 0) {
      return { ok: false, message: "Amount must be a non-zero number" };
    }
    if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
      return { ok: false, message: "A valid fiscal year is required" };
    }
    const organizationId = await getCurrentOrgId();
    await prisma.memberEquityEntry.create({
      data: {
        entryId: makeId("MEQ"),
        organizationId,
        memberAccountId: input.memberAccountId,
        fiscalYear: input.fiscalYear,
        kind: input.kind,
        amount: input.amount,
        qualified: input.qualified ?? false,
        cashPortion: input.cashPortion ?? null,
        notes: input.notes?.trim() || null,
      },
    });
    revalidatePath("/member-equity");
    return { ok: true, message: "Equity entry recorded" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to record entry" };
  }
}

export async function retireEquity(input: {
  memberAccountId: string;
  fiscalYear: number;
  amount: number;
  notes?: string;
}): Promise<MemberEquityActionResult> {
  await requireManageCompliance();
  try {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: "Retirement amount must be a positive number" };
    }
    const organizationId = await getCurrentOrgId();
    const balance = await prisma.memberEquityEntry.aggregate({
      where: { organizationId, memberAccountId: input.memberAccountId },
      _sum: { amount: true },
    });
    const current = Number(balance._sum.amount ?? 0);
    if (input.amount > current) {
      return {
        ok: false,
        message: `Retirement exceeds the member's equity balance (${current.toFixed(2)})`,
      };
    }
    await prisma.memberEquityEntry.create({
      data: {
        entryId: makeId("MEQ"),
        organizationId,
        memberAccountId: input.memberAccountId,
        fiscalYear: input.fiscalYear,
        kind: "equity-retirement",
        amount: -input.amount,
        notes: input.notes?.trim() || null,
      },
    });
    revalidatePath("/member-equity");
    return { ok: true, message: "Equity retired" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to retire equity" };
  }
}

/**
 * Year-end patronage allocation v1: allocates the pool EQUALLY across all
 * active member accounts (proportional-to-patronage weighting is a documented
 * follow-up — no purchase-volume basis exists on the platform yet). Enforces
 * the Subchapter T >=20% cash floor for qualified allocations.
 */
export async function runPatronageAllocation(input: {
  fiscalYear: number;
  totalPool: number;
  cashPct: number;
  qualified: boolean;
}): Promise<MemberEquityActionResult & { members?: number; perMember?: number }> {
  await requireManageCompliance();
  try {
    if (!Number.isFinite(input.totalPool) || input.totalPool <= 0) {
      return { ok: false, message: "Total patronage pool must be a positive number" };
    }
    if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
      return { ok: false, message: "A valid fiscal year is required" };
    }
    if (input.qualified && input.cashPct < QUALIFIED_CASH_FLOOR * 100) {
      return {
        ok: false,
        message: "Qualified allocations must pay at least 20% in cash (Subchapter T)",
      };
    }
    const organizationId = await getCurrentOrgId();

    const existing = await prisma.memberEquityEntry.findFirst({
      where: { organizationId, fiscalYear: input.fiscalYear, kind: "patronage-allocation" },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        message: `A patronage allocation already exists for FY${input.fiscalYear} — record adjustments instead of re-running`,
      };
    }

    const members = await prisma.customerAccount.findMany({
      where: { status: "active" },
      select: { id: true },
    });
    if (members.length === 0) {
      return { ok: false, message: "No active member accounts to allocate to" };
    }

    const perMember = Math.floor((input.totalPool / members.length) * 100) / 100;
    const cashPerMember = Math.floor(perMember * input.cashPct) / 100;

    await prisma.memberEquityEntry.createMany({
      data: members.map((member) => ({
        entryId: makeId("MEQ"),
        organizationId,
        memberAccountId: member.id,
        fiscalYear: input.fiscalYear,
        kind: "patronage-allocation",
        amount: perMember,
        qualified: input.qualified,
        cashPortion: cashPerMember,
        notes: `FY${input.fiscalYear} year-end allocation — equal split of ${input.totalPool.toFixed(2)} across ${members.length} members (patronage-basis weighting pending)`,
      })),
    });
    revalidatePath("/member-equity");
    return {
      ok: true,
      message: `Allocated to ${members.length} members (${perMember.toFixed(2)} each)`,
      members: members.length,
      perMember,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Allocation failed" };
  }
}
