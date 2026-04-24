// adp_get_pay_statements — MCP tool returning paginated pay statements for a worker,
// with bank routing and account numbers redacted before the LLM sees the result.

import { z } from "zod";
import { getSql } from "../lib/db.js";
import { getActiveCredential, recordToolCall, AdpNotConnectedError } from "../lib/creds.js";
import { adpGet, AdpApiError } from "../lib/adp-client.js";
import { redact } from "../lib/redact.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366; // one year, plus leap-year fudge
const WORKER_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export const GetPayStatementsArgsSchema = z
  .object({
    workerId: z
      .string()
      .regex(WORKER_ID_PATTERN, "workerId must be 3-64 alphanumeric/_/- characters"),
    fromDate: z.string().regex(ISO_DATE_PATTERN, "fromDate must be YYYY-MM-DD"),
    toDate: z.string().regex(ISO_DATE_PATTERN, "toDate must be YYYY-MM-DD"),
    cursor: z.string().optional(),
  })
  .strict()
  .refine(
    (args) => {
      const from = Date.parse(args.fromDate);
      const to = Date.parse(args.toDate);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      if (to < from) return false;
      const days = (to - from) / (1000 * 60 * 60 * 24);
      return days <= MAX_RANGE_DAYS;
    },
    { message: `date range must be valid and ≤ ${MAX_RANGE_DAYS} days` },
  );

export type GetPayStatementsArgs = z.infer<typeof GetPayStatementsArgsSchema>;

export interface PayStatementSummary {
  statementId: string;
  payDate: string | null;
  grossPay: number | null;
  netPay: number | null;
  currency: string | null;
  earnings: Array<{ code: string | null; amount: number | null }>;
  deductions: Array<{ code: string | null; amount: number | null }>;
  taxes: Array<{ code: string | null; amount: number | null }>;
}

export interface GetPayStatementsResult {
  payStatements: PayStatementSummary[];
  nextCursor: string | null;
  suspiciousContentDetected: boolean;
}

// Shape consumed from ADP's /payroll/v1/workers/{aoid}/pay-statements endpoint.
// ADP returns a richer payload (direct-deposit details, YTD accruals, etc.) —
// we cherry-pick what the Payroll Specialist coworker needs.
interface AdpPayStatementsResponse {
  payStatements?: Array<{
    statementID?: string;
    payDate?: string;
    grossPayAmount?: { amountValue?: number; currencyCode?: string };
    netPayAmount?: { amountValue?: number; currencyCode?: string };
    earnings?: Array<{
      earningCode?: { codeValue?: string };
      amount?: { amountValue?: number };
    }>;
    deductions?: Array<{
      deductionCode?: { codeValue?: string };
      amount?: { amountValue?: number };
    }>;
    taxes?: Array<{
      taxCode?: { codeValue?: string };
      amount?: { amountValue?: number };
    }>;
    // directDeposits, YTD accruals, etc. — not mapped; we rely on the redactor
    // to scrub any bank/account fields that might leak via the whole-object
    // redact pass even though the downstream consumer never reads them.
  }>;
  meta?: {
    totalNumber?: number;
    continuationToken?: string;
  };
}

export interface GetPayStatementsContext {
  coworkerId: string;
  userId: string | null;
}

export async function getPayStatements(
  rawArgs: unknown,
  ctx: GetPayStatementsContext,
): Promise<GetPayStatementsResult> {
  const args = GetPayStatementsArgsSchema.parse(rawArgs);
  const sql = getSql();
  const startedAt = Date.now();

  try {
    const credential = await getActiveCredential(sql);

    const response = await adpGet<AdpPayStatementsResponse>({
      credential,
      path: `/payroll/v1/workers/${encodeURIComponent(args.workerId)}/pay-statements`,
      query: {
        "statementDate.start": args.fromDate,
        "statementDate.end": args.toDate,
        ...(args.cursor ? { continuationToken: args.cursor } : {}),
      },
    });

    const mapped: PayStatementSummary[] = (response.payStatements ?? []).map((s) => ({
      statementId: s.statementID ?? "",
      payDate: s.payDate ?? null,
      grossPay: s.grossPayAmount?.amountValue ?? null,
      netPay: s.netPayAmount?.amountValue ?? null,
      currency:
        s.grossPayAmount?.currencyCode ?? s.netPayAmount?.currencyCode ?? null,
      earnings: (s.earnings ?? []).map((e) => ({
        code: e.earningCode?.codeValue ?? null,
        amount: e.amount?.amountValue ?? null,
      })),
      deductions: (s.deductions ?? []).map((d) => ({
        code: d.deductionCode?.codeValue ?? null,
        amount: d.amount?.amountValue ?? null,
      })),
      taxes: (s.taxes ?? []).map((t) => ({
        code: t.taxCode?.codeValue ?? null,
        amount: t.amount?.amountValue ?? null,
      })),
    }));

    const redacted = redact({ payStatements: mapped });

    const result: GetPayStatementsResult = {
      payStatements: redacted.value.payStatements,
      nextCursor: response.meta?.continuationToken ?? null,
      suspiciousContentDetected: redacted.suspiciousContentDetected,
    };

    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_pay_statements",
      args,
      responseKind: "success",
      resultCount: mapped.length,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    });

    console.log(
      `[tool-trace] adp_get_pay_statements coworker=${ctx.coworkerId} workerId=${args.workerId} resultCount=${mapped.length} duration=${Date.now() - startedAt}ms`,
    );

    return result;
  } catch (err) {
    const { errorCode, errorMessage, responseKind } = classifyError(err);
    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_pay_statements",
      args,
      responseKind,
      resultCount: null,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
    });
    console.log(
      `[tool-trace] adp_get_pay_statements coworker=${ctx.coworkerId} kind=${responseKind} code=${errorCode} duration=${Date.now() - startedAt}ms`,
    );
    throw err;
  }
}

function classifyError(err: unknown): {
  errorCode: string;
  errorMessage: string;
  responseKind: "error" | "rate-limited";
} {
  if (err instanceof AdpApiError) {
    return {
      errorCode: err.code,
      errorMessage: err.message,
      responseKind: err.code === "RATE_LIMITED" ? "rate-limited" : "error",
    };
  }
  if (err instanceof AdpNotConnectedError) {
    return { errorCode: "NOT_CONNECTED", errorMessage: err.message, responseKind: "error" };
  }
  if (err instanceof Error) {
    return { errorCode: "UNKNOWN", errorMessage: err.message, responseKind: "error" };
  }
  return { errorCode: "UNKNOWN", errorMessage: "unknown error", responseKind: "error" };
}

export const TOOL_DEFINITION = {
  name: "adp_get_pay_statements",
  description:
    "Retrieve paginated pay statements for a single worker within a date range. Returns gross pay, net pay, currency, and itemized earnings/deductions/taxes per statement. Bank account numbers, routing numbers, and other PII are redacted before reaching the LLM. Use the nextCursor field to page through long ranges.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workerId: {
        type: "string",
        description: "ADP worker ID (associateOID or employee number) — 3-64 alphanumeric/_/- characters",
      },
      fromDate: { type: "string", description: "Range start (YYYY-MM-DD)" },
      toDate: { type: "string", description: "Range end (YYYY-MM-DD). Range must be ≤ 366 days." },
      cursor: { type: "string", description: "Opaque pagination token from a previous call's nextCursor" },
    },
    required: ["workerId", "fromDate", "toDate"],
    additionalProperties: false,
  },
};
