// System-of-record read pack (EP-27FD96BC P5, BI-97BF837B). Coworkers could list
// customer accounts, opportunities, and quotes, but the operational records those
// accounts generate — invoices and payments — had no read tool at all, so a
// coworker asked "did account X pay their last invoice?" had to guess or tell the
// operator to go look. This gives it a governed, read-only door to those records.
//
// JIT-retrieval discipline (BI-223E55DA): every read is LIVE from Prisma, never a
// memorized/vectorized snapshot — the coworker reasons over the current database.
// The entityType → reader map is the convention: adding a model is one entry.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const MAX_ROWS = 20;

/** Prisma Decimal / Date → JSON-safe primitives. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "toString" in (value as object)) {
    // Prisma Decimal serializes cleanly via toString.
    const s = (value as { toString(): string }).toString();
    return /^-?\d+(\.\d+)?$/.test(s) ? s : value;
  }
  return value;
}

type SorReader = (args: { id?: string; ref?: string; limit: number }) => Promise<unknown[]>;

interface SorEntity {
  label: string;
  read: SorReader;
}

const SOR_READERS: Record<string, SorEntity> = {
  invoice: {
    label: "Invoice",
    read: async ({ id, ref, limit }) => {
      const where = id ? { id } : ref ? { invoiceRef: ref } : {};
      const rows = await prisma.invoice.findMany({
        where,
        orderBy: { issueDate: "desc" },
        take: id || ref ? 1 : limit,
        select: {
          invoiceRef: true, status: true, accountId: true, currency: true,
          totalAmount: true, amountPaid: true, amountDue: true,
          issueDate: true, dueDate: true, paidAt: true,
        },
      });
      return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
    },
  },
  payment: {
    label: "Payment",
    read: async ({ id, ref, limit }) => {
      const where = id ? { id } : ref ? { paymentRef: ref } : {};
      const rows = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: id || ref ? 1 : limit,
        select: {
          paymentRef: true, method: true, status: true,
          amount: true, currency: true, receivedAt: true, createdAt: true,
        },
      });
      return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
    },
  },
};

const ENTITY_TYPES = Object.keys(SOR_READERS);

const definitions: ToolDefinition[] = [
  {
    name: "read_operational_record",
    description:
      "Read a customer's live operational records — invoices and payments — straight from the system of record. " +
      "Pass entityType plus an optional ref (e.g. an invoice number) or id to fetch one, or neither to list the most recent. " +
      "Use this to answer questions like whether an account paid its last invoice, instead of guessing from account notes.",
    inputSchema: {
      type: "object",
      properties: {
        entityType: {
          type: "string",
          enum: ENTITY_TYPES,
          description: "Which record to read: invoice or payment.",
        },
        ref: { type: "string", description: "Optional business reference (e.g. invoiceRef / paymentRef) to fetch one record." },
        id: { type: "string", description: "Optional record id to fetch one record." },
        limit: { type: "number", description: `Max rows when listing (default 10, cap ${MAX_ROWS}).` },
      },
      required: ["entityType"],
    },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
];

async function readOperationalRecordTool(params: Record<string, unknown>): Promise<ToolResult> {
  const entityType = typeof params.entityType === "string" ? params.entityType : "";
  const entity = SOR_READERS[entityType];
  if (!entity) {
    return {
      success: false,
      message: `Unknown entityType "${entityType}". Supported: ${ENTITY_TYPES.join(", ")}.`,
    };
  }
  const id = typeof params.id === "string" ? params.id : undefined;
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const rawLimit = typeof params.limit === "number" ? params.limit : 10;
  const limit = Math.max(1, Math.min(MAX_ROWS, Math.floor(rawLimit)));

  try {
    const rows = await entity.read({ id, ref, limit });
    if (rows.length === 0) {
      return { success: true, message: `No ${entity.label} record found.`, data: { rows: [] } };
    }
    return {
      success: true,
      message: `${rows.length} ${entity.label} record(s).`,
      data: { rows } as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return { success: false, message: `Failed to read ${entity.label}: ${getErrorMessage(err)}` };
  }
}

export const sorReadPack: ToolPack = {
  packId: "sor-read",
  definitions,
  handlers: {
    read_operational_record: readOperationalRecordTool,
  },
  grants: {
    read_operational_record: ["crm_read"],
  },
};

// Exported for tests + future extension.
export { SOR_READERS, ENTITY_TYPES };
