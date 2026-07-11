"use server";

// apps/web/lib/actions/memory-audit.ts
// Server actions for the coworker memory transparency surface — BI-DC8B03AB
// (EP-8C706944 Phase 4). A user can see and forget what a coworker remembers
// about them; an admin can review org-shared facts + coworker working notes. All
// shaping lives in the pure memory-audit-shape module; these actions only guard,
// query, and mutate.

import { prisma } from "@dpf/db";
import { requireUserId, requireCapability } from "@/lib/actions/shared/guards";
import {
  groupAuditRows,
  summarizeAudit,
  type MemoryAuditFact,
  type MyMemoryAudit,
  type OrgMemoryAudit,
} from "./memory-audit-shape";

const FACT_SELECT = {
  id: true,
  category: true,
  key: true,
  value: true,
  scope: true,
  sensitivity: true,
  sourceRoute: true,
  createdAt: true,
  lastAccessedAt: true,
} as const;

/** What does my coworker remember about me — the calling user's active facts. */
export async function loadMyMemoryAudit(): Promise<MyMemoryAudit> {
  const userId = await requireUserId();
  const facts = (await prisma.userFact.findMany({
    where: { userId, supersededAt: null },
    orderBy: { createdAt: "desc" },
    select: FACT_SELECT,
  })) as MemoryAuditFact[];
  return { groups: groupAuditRows(facts), summary: summarizeAudit(facts) };
}

/**
 * BI-CCF1ACBB consumer: the calling user's cumulative AI spend across all their
 * coworker threads — surfaces the per-thread token/cost ledger on the memory
 * transparency page. Formatted for display.
 */
export async function loadMySpendLine(): Promise<string> {
  const userId = await requireUserId();
  const threads = await prisma.agentThread.findMany({
    where: { userId },
    select: { id: true },
  });
  const { getEffortSpend } = await import("@/lib/tak/thread-cost-ledger-runner");
  const { formatThreadSpend } = await import("@/lib/tak/thread-cost-ledger");
  const spend = await getEffortSpend(threads.map((t) => t.id));
  return formatThreadSpend(spend);
}

/**
 * Forget one fact the calling user owns (supersede, never a hard delete — the
 * provenance chain survives; it just stops being injected). Ownership is enforced
 * by scoping the update to the caller's userId.
 */
export async function forgetMyFact(factId: string): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const res = await prisma.userFact.updateMany({
    where: { id: factId, userId, supersededAt: null },
    data: { supersededAt: new Date() },
  });
  return { ok: res.count > 0 };
}

/**
 * Admin view: org-shared (non-sensitive) facts across the workforce + every
 * coworker's active working notes. Read-only; requires the admin AI-management
 * capability.
 */
export async function loadOrgMemoryAudit(): Promise<OrgMemoryAudit> {
  await requireCapability("manage_agents");
  const [orgFacts, notes] = await Promise.all([
    prisma.userFact.findMany({
      where: { scope: "org", sensitivity: "normal", supersededAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: FACT_SELECT,
    }),
    prisma.coworkerMemoryNote.findMany({
      where: { supersededAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, agentId: true, noteKind: true, noteKey: true, content: true, createdAt: true },
    }),
  ]);
  const facts = orgFacts as MemoryAuditFact[];
  return {
    facts: groupAuditRows(facts),
    summary: summarizeAudit(facts),
    notes,
  };
}
