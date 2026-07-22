// Business-approval sources — outbound / bill / expense / compliance / research.
// These are the DEADLINE-bearing queues, so they exercise the §4.4 override tier:
// a bill or regulatory filing due today floats to the top, shown with its reason.
// Pure mappers (nowMs injected for the deadline tier). Operator-view in this slice
// — worker-principal scoping needs approver-role resolution (follow-on).
// Spec §1 (queues 3-7), §4.1, §4.4. Partially delivers BI-8EA88797.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";
import { timeToActFromDeadline } from "../triage";

type Db = typeof prisma;

function clip(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ─── Outbound drafts (marketing) — no deadline ───────────────────────────────

export type OutboundDraftRow = {
  draftId: string;
  channelId: string;
  assetType: string;
  body: string;
  createdAt: Date;
};

export function outboundToAttentionItem(row: OutboundDraftRow): AttentionItem {
  return {
    id: `approval-outbound:${row.draftId}`,
    source: "approval-outbound",
    title: `Approve ${row.assetType} for ${row.channelId}`,
    context: clip(row.body),
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Review draft", href: "/customer/marketing" }],
    deepLink: "/customer/marketing",
    audience: { operator: true },
  };
}

export async function loadOutboundItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.outboundDraft.findMany({
    where: { status: "pending-review" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { draftId: true, channelId: true, assetType: true, body: true, createdAt: true },
  });
  return rows.map(outboundToAttentionItem);
}

// ─── Bills (AP) — hard dueDate ───────────────────────────────────────────────

export type BillRow = {
  id: string;
  billRef: string;
  currency: string;
  amountDue: string;
  dueDate: Date;
  createdAt: Date;
};

export function billToAttentionItem(row: BillRow, nowMs: number): AttentionItem {
  const deadlineIso = row.dueDate.toISOString();
  // Deep-link to the exact bill, not the bills list, so the owner lands on the
  // specific decision instead of re-finding it (BI-1336126B). The detail route
  // resolves by internal `id` (see getBill / the bills list row links).
  const href = `/finance/bills/${encodeURIComponent(row.id)}`;
  return {
    id: `approval-bill:${row.billRef}`,
    source: "approval-bill",
    title: `Approve bill ${row.billRef}`,
    context: `${row.currency} ${row.amountDue} due`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: timeToActFromDeadline(deadlineIso, nowMs),
      deadlineIso,
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Review bill", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

export async function loadBillItems(db: Db): Promise<AttentionItem[]> {
  const nowMs = Date.now();
  const rows = await db.bill.findMany({
    where: { status: "awaiting_approval" },
    orderBy: { dueDate: "asc" },
    take: 50,
    select: { id: true, billRef: true, currency: true, amountDue: true, dueDate: true, createdAt: true },
  });
  return rows.map((r) =>
    billToAttentionItem({ ...r, amountDue: r.amountDue.toString() }, nowMs),
  );
}

// ─── Expense claims — no hard deadline ───────────────────────────────────────

export type ExpenseClaimRow = {
  id: string;
  claimId: string;
  title: string;
  currency: string;
  totalAmount: string;
  submittedAt: Date | null;
  createdAt: Date;
};

export function expenseToAttentionItem(row: ExpenseClaimRow): AttentionItem {
  // Deep-link to the exact claim (resolved by internal `id`, per getExpenseClaim).
  const href = `/finance/expense-claims/${encodeURIComponent(row.id)}`;
  return {
    id: `approval-expense:${row.claimId}`,
    source: "approval-expense",
    title: `Approve expense: ${row.title}`,
    context: `${row.currency} ${row.totalAmount}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: (row.submittedAt ?? row.createdAt).toISOString(),
    actions: [{ kind: "open-in-context", label: "Review claim", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

export async function loadExpenseItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.expenseClaim.findMany({
    where: { status: "submitted" },
    orderBy: { submittedAt: "desc" },
    take: 50,
    select: { id: true, claimId: true, title: true, currency: true, totalAmount: true, submittedAt: true, createdAt: true },
  });
  return rows.map((r) => expenseToAttentionItem({ ...r, totalAmount: r.totalAmount.toString() }));
}

// ─── Regulatory submissions — hard dueDate, high stakes ──────────────────────

export type RegulatorySubmissionRow = {
  id: string;
  submissionId: string;
  title: string;
  recipientBody: string;
  submissionType: string;
  dueDate: Date | null;
  createdAt: Date;
};

export function regulatoryToAttentionItem(row: RegulatorySubmissionRow, nowMs: number): AttentionItem {
  const deadlineIso = row.dueDate ? row.dueDate.toISOString() : undefined;
  // Deep-link to the exact submission (resolved by internal `id`, per getSubmission).
  const href = `/compliance/submissions/${encodeURIComponent(row.id)}`;
  return {
    id: `compliance-submission:${row.submissionId}`,
    source: "compliance-submission",
    title: `File: ${row.title}`,
    context: `${row.submissionType} to ${row.recipientBody}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "high-risk", // a missed regulatory deadline is high-stakes
    triage: {
      timeToAct: timeToActFromDeadline(deadlineIso, nowMs),
      deadlineIso,
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open submission", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

export async function loadRegulatoryItems(db: Db): Promise<AttentionItem[]> {
  const nowMs = Date.now();
  const rows = await db.regulatorySubmission.findMany({
    where: { status: "draft" },
    orderBy: { dueDate: "asc" },
    take: 50,
    select: {
      id: true,
      submissionId: true,
      title: true,
      recipientBody: true,
      submissionType: true,
      dueDate: true,
      createdAt: true,
    },
  });
  return rows.map((r) => regulatoryToAttentionItem(r, nowMs));
}

// ─── Research proposals — low risk, no deadline ──────────────────────────────

export type ResearchProposalRow = {
  proposalId: string;
  topic: string;
  query: string;
  proposedAt: Date;
};

export function researchToAttentionItem(row: ResearchProposalRow): AttentionItem {
  return {
    id: `research-proposal:${row.proposalId}`,
    source: "research-proposal",
    title: `Approve research: ${row.topic}`,
    context: clip(row.query),
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.proposedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Review proposal", href: "/admin/research" }],
    deepLink: "/admin/research",
    audience: { operator: true },
  };
}

export async function loadResearchItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.researchProposal.findMany({
    where: { status: "pending" },
    orderBy: { proposedAt: "desc" },
    take: 50,
    select: { proposalId: true, topic: true, query: true, proposedAt: true },
  });
  return rows.map(researchToAttentionItem);
}
