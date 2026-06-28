import {
  buildWorkCaseSummary,
  type WorkCaseReadModelWorkItemInput,
} from "./case-read-model";
import type { WorkCaseState } from "./case-types";
import {
  WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS,
  type WorkCaseAccountResolverKey,
  getWorkCaseAccountResolverKey,
  getWorkCaseSourceEntry,
} from "./source-registry";

const CLOSED_WORK_ITEM_STATUSES = ["completed", "cancelled"];

type AccountRow = {
  id: string;
  accountId: string;
  name: string;
};

type PortalWorkItemRecord = {
  id: string;
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string | null;
  urgency: string;
  effortClass: string;
  status: string;
  assignedToUserId: string | null;
  dueAt: Date | string | null;
  createdAt: Date | string;
};

type AccountSelectResult = {
  account: AccountRow | null;
} | null;

export type PortalCasePrismaClient = {
  workItem: {
    findMany(args: unknown): Promise<PortalWorkItemRecord[]>;
  };
  engagement: {
    findUnique(args: unknown): Promise<AccountSelectResult>;
  };
  opportunity: {
    findUnique(args: unknown): Promise<AccountSelectResult>;
  };
  storefrontBooking: {
    findUnique(args: unknown): Promise<{ customerContactId: string | null } | null>;
  };
  customerContact: {
    findUnique(args: unknown): Promise<AccountSelectResult>;
  };
  activity: {
    findUnique(args: unknown): Promise<AccountSelectResult>;
  };
};

export interface PortalWorkCaseListItem {
  caseId: string;
  href: string;
  title: string;
  sourceLabel: string;
  statusLabel: string;
  nextActionLabel: string;
  description: string | null;
  dueAt: string | null;
  attentionRequired: boolean;
}

export interface PortalWorkCaseListView {
  generatedAt: string;
  stats: {
    total: number;
    needsResponse: number;
    inProgress: number;
    resolved: number;
  };
  cases: PortalWorkCaseListItem[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function accountFromBooking(
  prismaClient: PortalCasePrismaClient,
  sourceId: string,
): Promise<AccountRow | null> {
  const booking = await prismaClient.storefrontBooking.findUnique({
    where: { bookingRef: sourceId },
    select: { customerContactId: true },
  });
  if (!booking?.customerContactId) return null;
  const contact = await prismaClient.customerContact.findUnique({
    where: { id: booking.customerContactId },
    select: { account: { select: { id: true, accountId: true, name: true } } },
  });
  return contact?.account ?? null;
}

async function resolveSourceAccount({
  prismaClient,
  resolverKey,
  sourceId,
}: {
  prismaClient: PortalCasePrismaClient;
  resolverKey: WorkCaseAccountResolverKey;
  sourceId: string;
}): Promise<AccountRow | null> {
  switch (resolverKey) {
    case "engagement": {
      const row = await prismaClient.engagement.findUnique({
        where: { engagementId: sourceId },
        select: { account: { select: { id: true, accountId: true, name: true } } },
      });
      return row?.account ?? null;
    }
    case "opportunity": {
      const row = await prismaClient.opportunity.findUnique({
        where: { opportunityId: sourceId },
        select: { account: { select: { id: true, accountId: true, name: true } } },
      });
      return row?.account ?? null;
    }
    case "booking":
      return accountFromBooking(prismaClient, sourceId);
    case "activity": {
      const row = await prismaClient.activity.findUnique({
        where: { activityId: sourceId },
        select: { account: { select: { id: true, accountId: true, name: true } } },
      });
      return row?.account ?? null;
    }
  }
}

function portalStatusFor(state: WorkCaseState): {
  statusLabel: string;
  nextActionLabel: string;
  needsResponse: boolean;
  inProgress: boolean;
  resolved: boolean;
} {
  switch (state) {
    case "waiting-on-person":
    case "awaiting-decision":
      return {
        statusLabel: "Needs your response",
        nextActionLabel: "Reply requested",
        needsResponse: true,
        inProgress: false,
        resolved: false,
      };
    case "waiting-on-system":
      return {
        statusLabel: "Waiting on service",
        nextActionLabel: "We are monitoring it",
        needsResponse: false,
        inProgress: true,
        resolved: false,
      };
    case "resolved":
    case "closed":
      return {
        statusLabel: "Resolved",
        nextActionLabel: "No action needed",
        needsResponse: false,
        inProgress: false,
        resolved: true,
      };
    case "cancelled":
      return {
        statusLabel: "Cancelled",
        nextActionLabel: "No action needed",
        needsResponse: false,
        inProgress: false,
        resolved: true,
      };
    case "active":
    case "verifying":
      return {
        statusLabel: "In progress",
        nextActionLabel: "We are working on it",
        needsResponse: false,
        inProgress: true,
        resolved: false,
      };
    case "intake":
    case "triage":
      return {
        statusLabel: "Received",
        nextActionLabel: "We are reviewing it",
        needsResponse: false,
        inProgress: true,
        resolved: false,
      };
  }
}

function toWorkItemInput(item: PortalWorkItemRecord): WorkCaseReadModelWorkItemInput {
  return {
    itemId: item.itemId,
    title: item.title,
    status: item.status,
    urgency: item.urgency,
    dueAt: item.dueAt,
    assignedToUserId: item.assignedToUserId,
  };
}

async function toPortalCase({
  prismaClient,
  item,
  customerAccountId,
}: {
  prismaClient: PortalCasePrismaClient;
  item: PortalWorkItemRecord;
  customerAccountId: string;
}): Promise<PortalWorkCaseListItem | null> {
  const sourceId = item.sourceId?.trim();
  const resolverKey = getWorkCaseAccountResolverKey(item.sourceType);
  if (!sourceId || !resolverKey) return null;
  const account = await resolveSourceAccount({ prismaClient, resolverKey, sourceId });
  if (account?.accountId !== customerAccountId) return null;

  const summary = buildWorkCaseSummary({
    source: {
      sourceType: item.sourceType,
      sourceId,
    },
    workItem: toWorkItemInput(item),
  });
  const portalStatus = portalStatusFor(summary.state);
  const entry = getWorkCaseSourceEntry(item.sourceType);

  return {
    caseId: summary.caseId,
    href: `/portal/cases#${slug(summary.caseId)}`,
    title: summary.title,
    sourceLabel: entry?.displayLabel ?? summary.sourceLabel,
    statusLabel: portalStatus.statusLabel,
    nextActionLabel: portalStatus.nextActionLabel,
    description: item.description,
    dueAt: iso(item.dueAt),
    attentionRequired: portalStatus.needsResponse || summary.attention.required,
  };
}

function sortCases(left: PortalWorkCaseListItem, right: PortalWorkCaseListItem): number {
  if (left.attentionRequired !== right.attentionRequired) {
    return left.attentionRequired ? -1 : 1;
  }
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return leftDue - rightDue || left.title.localeCompare(right.title);
}

export async function loadPortalWorkCaseList({
  prismaClient,
  customerAccountId,
  now = new Date(),
  limit = 100,
}: {
  prismaClient: PortalCasePrismaClient;
  customerAccountId: string;
  now?: Date;
  limit?: number;
}): Promise<PortalWorkCaseListView> {
  const items = await prismaClient.workItem.findMany({
    where: {
      sourceType: { in: WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS },
      status: { notIn: CLOSED_WORK_ITEM_STATUSES },
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
  const cases = (await Promise.all(
    items.map((item) => toPortalCase({ prismaClient, item, customerAccountId })),
  ))
    .filter((item): item is PortalWorkCaseListItem => Boolean(item))
    .sort(sortCases);

  return {
    generatedAt: now.toISOString(),
    stats: {
      total: cases.length,
      needsResponse: cases.filter((item) => item.statusLabel === "Needs your response").length,
      inProgress: cases.filter((item) => item.statusLabel === "In progress" || item.statusLabel === "Received" || item.statusLabel === "Waiting on service").length,
      resolved: cases.filter((item) => item.statusLabel === "Resolved" || item.statusLabel === "Cancelled").length,
    },
    cases,
  };
}
