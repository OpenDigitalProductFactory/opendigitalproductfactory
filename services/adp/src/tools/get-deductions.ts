// adp_get_deductions — recurring deduction configuration for a worker.
// Garnishment account numbers and any nested payee accountNumber fields are
// scrubbed via the shared redact() pass.

import { z } from "zod";
import { getSql } from "../lib/db.js";
import { getActiveCredential, recordToolCall, AdpNotConnectedError } from "../lib/creds.js";
import { adpGet, AdpApiError } from "../lib/adp-client.js";
import { redact } from "../lib/redact.js";

const WORKER_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export const GetDeductionsArgsSchema = z
  .object({
    workerId: z
      .string()
      .regex(WORKER_ID_PATTERN, "workerId must be 3-64 alphanumeric/_/- characters"),
  })
  .strict();

export type GetDeductionsArgs = z.infer<typeof GetDeductionsArgsSchema>;

export interface DeductionSummary {
  deductionId: string;
  code: string | null;
  shortName: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  frequency: string | null;
  payeeName: string | null;
  // payee accountNumber is redacted by the shared redact() pass if present.
  payeeAccountNumber: string | null;
}

export interface GetDeductionsResult {
  deductions: DeductionSummary[];
  suspiciousContentDetected: boolean;
}

interface AdpDeductionsResponse {
  deductions?: Array<{
    deductionID?: string;
    code?: { codeValue?: string; shortName?: string };
    description?: string;
    amount?: { amountValue?: number; currencyCode?: string };
    frequency?: string;
    payee?: {
      name?: string;
      accountNumber?: string;
    };
    // free-text `comment` passes through the redactor's jailbreak scrub.
    comment?: string;
  }>;
}

export interface GetDeductionsContext {
  coworkerId: string;
  userId: string | null;
}

export async function getDeductions(
  rawArgs: unknown,
  ctx: GetDeductionsContext,
): Promise<GetDeductionsResult> {
  const args = GetDeductionsArgsSchema.parse(rawArgs);
  const sql = getSql();
  const startedAt = Date.now();

  try {
    const credential = await getActiveCredential(sql);

    const response = await adpGet<AdpDeductionsResponse>({
      credential,
      path: `/payroll/v1/workers/${encodeURIComponent(args.workerId)}/deductions`,
    });

    // Redact the RAW response first so any free-text fields we don't map
    // (comment, narrative) still surface prompt-injection flags even though
    // they don't reach the mapped output. This is defense in depth — an
    // unmapped but scanned field protects against future map changes that
    // would otherwise suddenly start exposing new surfaces to the LLM.
    const rawRedacted = redact(response);
    const mapped: DeductionSummary[] = (rawRedacted.value.deductions ?? []).map((d) => ({
      deductionId: d.deductionID ?? "",
      code: d.code?.codeValue ?? null,
      shortName: d.code?.shortName ?? null,
      description: d.description ?? null,
      amount: typeof d.amount?.amountValue === "number" ? d.amount.amountValue : null,
      currency: d.amount?.currencyCode ?? null,
      frequency: d.frequency ?? null,
      payeeName: d.payee?.name ?? null,
      payeeAccountNumber: d.payee?.accountNumber ?? null,
    }));

    const result: GetDeductionsResult = {
      deductions: mapped,
      suspiciousContentDetected: rawRedacted.suspiciousContentDetected,
    };

    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_deductions",
      args,
      responseKind: "success",
      resultCount: mapped.length,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    });

    console.log(
      `[tool-trace] adp_get_deductions coworker=${ctx.coworkerId} workerId=${args.workerId} resultCount=${mapped.length} duration=${Date.now() - startedAt}ms`,
    );

    return result;
  } catch (err) {
    const { errorCode, errorMessage, responseKind } = classifyError(err);
    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_deductions",
      args,
      responseKind,
      resultCount: null,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
    });
    console.log(
      `[tool-trace] adp_get_deductions coworker=${ctx.coworkerId} kind=${responseKind} code=${errorCode} duration=${Date.now() - startedAt}ms`,
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
  name: "adp_get_deductions",
  description:
    "Retrieve a worker's recurring deductions — benefits, garnishments, retirement contributions, etc. Returns code, description, amount, frequency, and payee name per deduction. Payee account numbers are redacted before reaching the LLM.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workerId: {
        type: "string",
        description: "ADP worker ID — 3-64 alphanumeric/_/- characters",
      },
    },
    required: ["workerId"],
    additionalProperties: false,
  },
};
