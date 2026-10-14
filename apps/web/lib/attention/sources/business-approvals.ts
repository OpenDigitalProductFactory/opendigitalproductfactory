// Business-approval sources — outbound / bill / expense / compliance / research.
// These are the DEADLINE-bearing queues, so they exercise the §4.4 override tier:
// a bill or regulatory filing due today floats to the top, shown with its reason.
// Pure mappers (nowMs injected for the deadline tier). Operator-view in this slice
// — worker-principal scoping needs approver-role resolution (follow-on).
// Spec §1 (queues 3-7), §4.1, §4.4. Partially delivers BI-8EA88797.

import type { prisma } from "@dpf/db";
import { LEAVE_DECISION_ROUTE } from "@/lib/workforce/leave/leave-decision-proposal-contract";
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

// ─── Time off — the manager's own approval (BI-7BCC87BB) ─────────────────────
//
// A time-off decision is the manager's act under HR approval authority; the
// advisor only recommends (spec D2 S5). It used to reach Needs-you only as an
// AgentActionProposal. Now there is one item per pending request, keyed by its
// requestId, so a legacy proposal and the request never double up (the
// proposal source leaves leave.decide rows out). A guard-only recommendation
// leaves no record, so every pending request is listed, as bills and expense
// claims are. Audience unchanged (operator view); FU-8 records the scoping gap.

export type LeaveApprovalRow = {
  requestId: string;
  leaveType: string;
  days: number;
  startDate: Date;
  createdAt: Date;
  decisionInteractionId: string | null;
  employeeName: string;
};

export function leaveApprovalToAttentionItem(row: LeaveApprovalRow): AttentionItem {
  const recommended = row.decisionInteractionId ? " The time-off advisor has a recommendation." : "";
  return {
    id: `approval-leave:${row.requestId}`,
    source: "approval-leave",
    title: `Decide time off for ${row.employeeName}`,
    context: `${row.days} day(s) of ${row.leaveType} from ${row.startDate.toISOString().slice(0, 10)}.${recommended}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      blastRadius: `time-off request ${row.requestId}`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Review time off", href: LEAVE_DECISION_ROUTE }],
    deepLink: LEAVE_DECISION_ROUTE,
    audience: { operator: true },
  };
}

export async function loadLeaveApprovalItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.leaveRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      requestId: true, leaveType: true, days: true, startDate: true, createdAt: true, decisionInteractionId: true,
      employeeProfile: { select: { displayName: true } },
    },
  });
  return rows.map((r) => leaveApprovalToAttentionItem({ ...r, employeeName: r.employeeProfile.displayName }));
}
