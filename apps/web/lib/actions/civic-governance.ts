"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireManageCompliance } from "./compliance-helpers";

// BI-8D477188 Phase 3 — public-body governance + records-request + 311 actions.
// "Civic" prefix distinguishes this from lib/actions/governance.ts (agent/TAK
// delegation governance). Conventions mirror lib/actions/compliance.ts: auth via
// requireManageCompliance, single-org resolution, { ok, message } result shape,
// revalidatePath refresh.

export type CivicActionResult = { ok: boolean; message: string; id?: string };

const RECORDS_REQUEST_STATUSES = [
  "submitted",
  "in-progress",
  "fulfilled",
  "partially-fulfilled",
  "denied",
  "withdrawn",
] as const;

export type RecordsRequestStatus = (typeof RECORDS_REQUEST_STATUSES)[number];

/** Default statutory response window (calendar days) when the org has not configured one. */
const DEFAULT_RECORDS_RESPONSE_DAYS = 10;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function getCurrentOrgId(): Promise<string> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("No organization found");
  return org.id;
}

// ─── Governance meetings ──────────────────────────────────────────────────────

export async function createGovernanceMeeting(input: {
  bodyType: string;
  title: string;
  scheduledAt: string;
  location?: string;
}): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!input.title.trim()) return { ok: false, message: "Title is required" };
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return { ok: false, message: "A valid meeting date/time is required" };
    }
    const organizationId = await getCurrentOrgId();
    const meeting = await prisma.governanceMeeting.create({
      data: {
        meetingId: makeId("GM"),
        organizationId,
        bodyType: input.bodyType || "council",
        title: input.title.trim(),
        scheduledAt,
        location: input.location?.trim() || null,
      },
    });
    revalidatePath("/governance");
    return { ok: true, message: `Meeting ${meeting.meetingId} scheduled`, id: meeting.id };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to create meeting" };
  }
}

export async function publishMeetingAgenda(
  id: string,
  agendaContent: string,
): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!agendaContent.trim()) return { ok: false, message: "Agenda content is required" };
    await prisma.governanceMeeting.update({
      where: { id },
      data: {
        agendaContent: agendaContent.trim(),
        agendaPublishedAt: new Date(),
        status: "agenda-published",
      },
    });
    revalidatePath("/governance");
    return { ok: true, message: "Agenda published" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to publish agenda" };
  }
}

export async function recordMeetingMinutes(
  id: string,
  minutesContent: string,
): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!minutesContent.trim()) return { ok: false, message: "Minutes content is required" };
    await prisma.governanceMeeting.update({
      where: { id },
      data: {
        minutesContent: minutesContent.trim(),
        minutesRecordedAt: new Date(),
        status: "minutes-recorded",
      },
    });
    revalidatePath("/governance");
    return { ok: true, message: "Minutes recorded" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to record minutes" };
  }
}

export async function approveMeetingMinutes(id: string): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    const meeting = await prisma.governanceMeeting.findUnique({
      where: { id },
      select: { minutesRecordedAt: true },
    });
    if (!meeting?.minutesRecordedAt) {
      return { ok: false, message: "Minutes must be recorded before approval" };
    }
    await prisma.governanceMeeting.update({
      where: { id },
      data: { minutesApprovedAt: new Date(), status: "minutes-approved" },
    });
    revalidatePath("/governance");
    return { ok: true, message: "Minutes approved" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to approve minutes" };
  }
}

export async function markMeetingHeld(id: string): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    await prisma.governanceMeeting.update({ where: { id }, data: { status: "held" } });
    revalidatePath("/governance");
    return { ok: true, message: "Meeting marked held" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to update meeting" };
  }
}

export async function cancelGovernanceMeeting(id: string): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    await prisma.governanceMeeting.update({ where: { id }, data: { status: "cancelled" } });
    revalidatePath("/governance");
    return { ok: true, message: "Meeting cancelled" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to cancel meeting" };
  }
}

// ─── Records requests ─────────────────────────────────────────────────────────

export async function createRecordsRequest(input: {
  requesterName: string;
  requesterEmail?: string;
  requesterPhone?: string;
  description: string;
}): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!input.requesterName.trim()) return { ok: false, message: "Requester name is required" };
    if (!input.description.trim()) return { ok: false, message: "Request description is required" };
    const organizationId = await getCurrentOrgId();
    const receivedAt = new Date();
    const responseDueAt = new Date(receivedAt);
    responseDueAt.setDate(responseDueAt.getDate() + DEFAULT_RECORDS_RESPONSE_DAYS);

    const request = await prisma.recordsRequest.create({
      data: {
        requestId: makeId("RR"),
        organizationId,
        requesterName: input.requesterName.trim(),
        requesterEmail: input.requesterEmail?.trim() || null,
        requesterPhone: input.requesterPhone?.trim() || null,
        description: input.description.trim(),
        receivedAt,
        responseDueAt,
      },
    });
    revalidatePath("/governance/records-requests");
    return { ok: true, message: `Records request ${request.requestId} logged`, id: request.id };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to log request" };
  }
}

export async function updateRecordsRequestStatus(
  id: string,
  status: string,
  detail?: { responseSummary?: string; denialReason?: string },
): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!RECORDS_REQUEST_STATUSES.includes(status as RecordsRequestStatus)) {
      return { ok: false, message: `Invalid status: ${status}` };
    }
    if (status === "denied" && !detail?.denialReason?.trim()) {
      return { ok: false, message: "A denial must cite the statutory exemption" };
    }
    const isTerminal = ["fulfilled", "partially-fulfilled", "denied", "withdrawn"].includes(status);
    await prisma.recordsRequest.update({
      where: { id },
      data: {
        status,
        responseSummary: detail?.responseSummary?.trim() || undefined,
        denialReason: detail?.denialReason?.trim() || undefined,
        ...(isTerminal ? { respondedAt: new Date() } : {}),
      },
    });
    revalidatePath("/governance/records-requests");
    return { ok: true, message: `Request marked ${status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to update request" };
  }
}

// ─── Fund budget lines (budget side of the budget-to-actual fund view) ────────

const FUNDS = [
  "general",
  "special-revenue",
  "enterprise",
  "capital-projects",
  "debt-service",
] as const;

export type FundKey = (typeof FUNDS)[number];

export async function upsertFundBudgetLine(input: {
  fiscalYear: number;
  fund: string;
  accountCode: string;
  budgetedAmount: number;
  notes?: string;
}): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    if (!FUNDS.includes(input.fund as FundKey)) {
      return { ok: false, message: `Invalid fund: ${input.fund}` };
    }
    if (!input.accountCode.trim()) return { ok: false, message: "Account code is required" };
    if (!Number.isFinite(input.budgetedAmount) || input.budgetedAmount < 0) {
      return { ok: false, message: "Budgeted amount must be a non-negative number" };
    }
    if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
      return { ok: false, message: "A valid fiscal year is required" };
    }
    const organizationId = await getCurrentOrgId();
    await prisma.fundBudgetLine.upsert({
      where: {
        organizationId_fiscalYear_fund_accountCode: {
          organizationId,
          fiscalYear: input.fiscalYear,
          fund: input.fund,
          accountCode: input.accountCode.trim(),
        },
      },
      create: {
        organizationId,
        fiscalYear: input.fiscalYear,
        fund: input.fund,
        accountCode: input.accountCode.trim(),
        budgetedAmount: input.budgetedAmount,
        notes: input.notes?.trim() || null,
      },
      update: {
        budgetedAmount: input.budgetedAmount,
        notes: input.notes?.trim() || null,
      },
    });
    revalidatePath("/finance/funds");
    return { ok: true, message: "Budget line saved" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to save budget line" };
  }
}

// ─── Service requests (311 over StorefrontInquiry) ────────────────────────────

export async function updateServiceRequestStatus(
  id: string,
  status: "new" | "in-progress" | "closed",
): Promise<CivicActionResult> {
  await requireManageCompliance();
  try {
    await prisma.storefrontInquiry.update({ where: { id }, data: { status } });
    revalidatePath("/service-requests");
    return { ok: true, message: `Service request marked ${status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to update service request" };
  }
}
