// Payables pack: read-only doors over what the business owes suppliers —
// recorded bills (Bill) and supplier agreements (SupplierContract).
//
// Paying, renewing and cancelling are human stages by construction; nothing
// here writes. An absent record is reported as unknown, never as nothing owed:
// an install with no bills returns { items: [], note: "No bills are recorded." }
// so a standing stage records inconclusive rather than "clear" or "unreachable".

import { BILL_STATUSES } from "@/lib/finance/ap-validation";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const COMMITMENT_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Bills in these states are settled or cancelled; every other state is open. */
const CLOSED_BILL_STATUSES = ["paid", "void"] as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const definitions: ToolDefinition[] = [
  {
    name: "list_bills",
    description:
      "List recorded supplier bills, earliest due first: bill reference, supplier, status, issue and due " +
      "dates, whether it is overdue, total and amount still due. Defaults to open bills (not paid, not " +
      "void); pass status 'all' or one bill status, and dueWithinDays to keep a horizon (overdue bills " +
      "stay in). Also lists recorded recurring supplier commitments with their billing cadence and " +
      "committed amount, naming any amount that is not recorded. When nothing is recorded the result " +
      "says so plainly; report that as unknown, never as nothing owed. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "all", ...BILL_STATUSES],
          description: "open (default), all, or one bill status.",
        },
        dueWithinDays: { type: "number", description: "Optional horizon in days (1-365); overdue bills are always included." },
        limit: { type: "number", description: `Rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
      required: [],
    },
    requiredCapability: "view_finance",
    executionMode: "immediate",
    sideEffect: false,
    annotations: READ_ONLY,
  },
  {
    name: "list_supplier_contracts",
    description:
      "List recorded supplier agreements, earliest renewal first: supplier, contract status and type, " +
      "billing cadence, start, end and renewal dates, committed amount and budget where recorded, and " +
      "the total billed against the agreement to date. Each row names its unknowns (no renewal date, no " +
      "committed amount). Filters: status, renewingWithinDays (renewals already past stay in), and " +
      "limit. When no agreement is recorded the result says so. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional contract status filter, e.g. active or draft." },
        renewingWithinDays: { type: "number", description: "Optional horizon in days (1-730) for the renewal date." },
        limit: { type: "number", description: `Rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
      required: [],
    },
    requiredCapability: "view_finance",
    executionMode: "immediate",
    sideEffect: false,
    annotations: READ_ONLY,
  },
];

type Amount = { toString(): string } | null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

const amount = (value: Amount | undefined): string | null => (value == null ? null : value.toString());
const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

type CommitmentRow = {
  contractId: string;
  status: string;
  contractType: string;
  commitmentKind: string;
  billingCadence: string;
  billingDayOfMonth: number | null;
  currency: string;
  monthlyCommittedAmount: Amount;
  budgetAmount: Amount;
  startDate: Date | null;
  endDate: Date | null;
  renewalDate: Date | null;
  supplier: { name: string; status: string };
};

const COMMITMENT_SELECT = {
  id: true,
  contractId: true,
  status: true,
  contractType: true,
  commitmentKind: true,
  billingCadence: true,
  billingDayOfMonth: true,
  currency: true,
  monthlyCommittedAmount: true,
  budgetAmount: true,
  startDate: true,
  endDate: true,
  renewalDate: true,
  supplier: { select: { name: true, status: true } },
} as const;

function commitmentView(row: CommitmentRow) {
  return {
    contractId: row.contractId,
    supplier: row.supplier.name,
    status: row.status,
    billingCadence: row.billingCadence,
    billingDayOfMonth: row.billingDayOfMonth,
    currency: row.currency,
    committedAmount: amount(row.monthlyCommittedAmount),
    unknowns: row.monthlyCommittedAmount == null ? ["committed amount not recorded"] : [],
  };
}

async function listBills(params: Record<string, unknown>): Promise<ToolResult> {
  const status = typeof params["status"] === "string" ? params["status"] : "open";
  if (status !== "open" && status !== "all" && !(BILL_STATUSES as readonly string[]).includes(status)) {
    return { success: false, error: "invalid_status", message: `status must be open, all, or one of: ${BILL_STATUSES.join(", ")}.` };
  }
  const horizonDays = params["dueWithinDays"] === undefined ? null : clampInt(params["dueWithinDays"], 30, 1, 365);
  const limit = clampInt(params["limit"], DEFAULT_LIMIT, 1, MAX_LIMIT);
  const now = Date.now();

  try {
    const { prisma } = await import("@dpf/db");
    const where = {
      ...(status === "open" ? { status: { notIn: [...CLOSED_BILL_STATUSES] } } : status === "all" ? {} : { status }),
      ...(horizonDays === null ? {} : { dueDate: { lte: new Date(now + horizonDays * DAY_MS) } }),
    };
    const [totalRecorded, bills, commitments] = await Promise.all([
      prisma.bill.count(),
      prisma.bill.findMany({
        where,
        orderBy: { dueDate: "asc" },
        take: limit,
        select: {
          billRef: true,
          status: true,
          invoiceRef: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          totalAmount: true,
          amountDue: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.supplierContract.findMany({
        orderBy: [{ renewalDate: { sort: "asc", nulls: "last" } }, { contractId: "asc" }],
        take: COMMITMENT_LIMIT,
        select: COMMITMENT_SELECT,
      }),
    ]);

    const recurringCommitments = (commitments as CommitmentRow[]).map(commitmentView);
    const items = bills.map((row) => ({
      billRef: row.billRef,
      supplier: row.supplier.name,
      status: row.status,
      invoiceRef: row.invoiceRef,
      issueDate: iso(row.issueDate),
      dueDate: iso(row.dueDate),
      overdue: row.dueDate.getTime() < now && !(CLOSED_BILL_STATUSES as readonly string[]).includes(row.status),
      currency: row.currency,
      totalAmount: amount(row.totalAmount),
      amountDue: amount(row.amountDue),
    }));

    let note: string | undefined;
    if (totalRecorded === 0) {
      note = "No bills are recorded.";
    } else if (items.length === 0) {
      const scope = status === "all" ? "bills" : `${status} bills`;
      note = horizonDays === null
        ? `No ${scope} are recorded (${totalRecorded} bill(s) recorded in other states).`
        : `No ${scope} fall due within ${horizonDays} day(s); ${totalRecorded} bill(s) are recorded.`;
    }
    const commitmentLine = `${recurringCommitments.length} recurring supplier commitment(s) recorded.`;
    return {
      success: true,
      message: note
        ? `${note} ${commitmentLine}`
        : `${items.length} bill(s) returned, ${items.filter((b) => b.overdue).length} overdue. ${commitmentLine}`,
      data: {
        items,
        ...(note ? { note } : {}),
        totalRecorded,
        recurringCommitments,
      },
    };
  } catch (error) {
    return { success: false, error: "payables_read_failed", message: getErrorMessage(error) };
  }
}

async function listSupplierContracts(params: Record<string, unknown>): Promise<ToolResult> {
  const status = typeof params["status"] === "string" && params["status"].trim() ? params["status"].trim() : null;
  const horizonDays = params["renewingWithinDays"] === undefined ? null : clampInt(params["renewingWithinDays"], 60, 1, 730);
  const limit = clampInt(params["limit"], DEFAULT_LIMIT, 1, MAX_LIMIT);

  try {
    const { prisma } = await import("@dpf/db");
    const where = {
      ...(status ? { status } : {}),
      ...(horizonDays === null ? {} : { renewalDate: { lte: new Date(Date.now() + horizonDays * DAY_MS) } }),
    };
    const [totalRecorded, contracts] = await Promise.all([
      prisma.supplierContract.count(),
      prisma.supplierContract.findMany({
        where,
        orderBy: [{ renewalDate: { sort: "asc", nulls: "last" } }, { contractId: "asc" }],
        take: limit,
        select: COMMITMENT_SELECT,
      }),
    ]);

    if (totalRecorded === 0) {
      const note = "No supplier contracts are recorded.";
      return { success: true, message: note, data: { items: [], note, totalRecorded } };
    }

    const ids = contracts.map((row) => row.id);
    const billed = ids.length
      ? await prisma.bill.groupBy({
          by: ["supplierContractId"],
          where: { supplierContractId: { in: ids }, status: { not: "void" } },
          _sum: { totalAmount: true },
        })
      : [];
    const billedById = new Map(billed.map((row) => [row.supplierContractId, amount(row._sum.totalAmount)]));

    const items = contracts.map((row) => {
      const unknowns: string[] = [];
      if (!row.renewalDate) unknowns.push("renewal date not recorded");
      if (row.monthlyCommittedAmount == null) unknowns.push("committed amount not recorded");
      return {
        contractId: row.contractId,
        supplier: row.supplier.name,
        supplierStatus: row.supplier.status,
        status: row.status,
        contractType: row.contractType,
        commitmentKind: row.commitmentKind,
        billingCadence: row.billingCadence,
        currency: row.currency,
        startDate: iso(row.startDate),
        endDate: iso(row.endDate),
        renewalDate: iso(row.renewalDate),
        committedAmount: amount(row.monthlyCommittedAmount),
        budgetAmount: amount(row.budgetAmount),
        billedToDate: billedById.get(row.id) ?? null,
        unknowns,
      };
    });

    const note = items.length === 0
      ? `${totalRecorded} supplier contract(s) are recorded, but none match the filter.`
      : undefined;
    return {
      success: true,
      message: note ?? `${items.length} supplier contract(s) returned of ${totalRecorded} recorded; ${items.filter((i) => !i.renewalDate).length} without a renewal date.`,
      data: { items, ...(note ? { note } : {}), totalRecorded },
    };
  } catch (error) {
    return { success: false, error: "payables_read_failed", message: getErrorMessage(error) };
  }
}

export const payablesPack: ToolPack = {
  packId: "payables",
  definitions,
  handlers: {
    list_bills: (params) => listBills(params),
    list_supplier_contracts: (params) => listSupplierContracts(params),
  },
  grants: {
    list_bills: ["payables_read"],
    list_supplier_contracts: ["payables_read"],
  },
};
