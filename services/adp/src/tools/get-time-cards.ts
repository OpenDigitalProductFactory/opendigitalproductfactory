// adp_get_time_cards — time cards for a worker in a pay period.
// Free-text `notes` fields are run through the redactor's jailbreak scrub.

import { z } from "zod";
import { getSql } from "../lib/db.js";
import { getActiveCredential, recordToolCall, AdpNotConnectedError } from "../lib/creds.js";
import { adpGet, AdpApiError } from "../lib/adp-client.js";
import { redact } from "../lib/redact.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORKER_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_RANGE_DAYS = 93; // one quarter — time-card pulls are short-horizon

export const GetTimeCardsArgsSchema = z
  .object({
    workerId: z
      .string()
      .regex(WORKER_ID_PATTERN, "workerId must be 3-64 alphanumeric/_/- characters"),
    payPeriodStart: z
      .string()
      .regex(ISO_DATE_PATTERN, "payPeriodStart must be YYYY-MM-DD"),
    payPeriodEnd: z
      .string()
      .regex(ISO_DATE_PATTERN, "payPeriodEnd must be YYYY-MM-DD"),
  })
  .strict()
  .refine(
    (args) => {
      const from = Date.parse(args.payPeriodStart);
      const to = Date.parse(args.payPeriodEnd);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      if (to < from) return false;
      const days = (to - from) / (1000 * 60 * 60 * 24);
      return days <= MAX_RANGE_DAYS;
    },
    { message: `payPeriodEnd must be after payPeriodStart and range ≤ ${MAX_RANGE_DAYS} days` },
  );

export type GetTimeCardsArgs = z.infer<typeof GetTimeCardsArgsSchema>;

export interface TimeCardEntry {
  date: string | null;
  hoursWorked: number | null;
  positionCode: string | null;
  notes: string | null;
}

export interface TimeCardSummary {
  timeCardId: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  totalHours: number | null;
  entries: TimeCardEntry[];
}

export interface GetTimeCardsResult {
  timeCards: TimeCardSummary[];
  suspiciousContentDetected: boolean;
}

interface AdpTimeCardsResponse {
  timeCards?: Array<{
    timeCardID?: string;
    payPeriodStart?: string;
    payPeriodEnd?: string;
    totalHours?: number;
    entries?: Array<{
      date?: string;
      hoursWorked?: number;
      positionCode?: string;
      notes?: string;
    }>;
  }>;
}

export interface GetTimeCardsContext {
  coworkerId: string;
  userId: string | null;
}

export async function getTimeCards(
  rawArgs: unknown,
  ctx: GetTimeCardsContext,
): Promise<GetTimeCardsResult> {
  const args = GetTimeCardsArgsSchema.parse(rawArgs);
  const sql = getSql();
  const startedAt = Date.now();

  try {
    const credential = await getActiveCredential(sql);

    const response = await adpGet<AdpTimeCardsResponse>({
      credential,
      path: `/time/v2/workers/${encodeURIComponent(args.workerId)}/time-cards`,
      query: {
        "payPeriod.start": args.payPeriodStart,
        "payPeriod.end": args.payPeriodEnd,
      },
    });

    const mapped: TimeCardSummary[] = (response.timeCards ?? []).map((tc) => ({
      timeCardId: tc.timeCardID ?? "",
      payPeriodStart: tc.payPeriodStart ?? null,
      payPeriodEnd: tc.payPeriodEnd ?? null,
      totalHours: typeof tc.totalHours === "number" ? tc.totalHours : null,
      entries: (tc.entries ?? []).map((e) => ({
        date: e.date ?? null,
        hoursWorked: typeof e.hoursWorked === "number" ? e.hoursWorked : null,
        positionCode: e.positionCode ?? null,
        notes: e.notes ?? null,
      })),
    }));

    const redacted = redact({ timeCards: mapped });

    const result: GetTimeCardsResult = {
      timeCards: redacted.value.timeCards,
      suspiciousContentDetected: redacted.suspiciousContentDetected,
    };

    const totalEntries = mapped.reduce((n, tc) => n + tc.entries.length, 0);

    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_time_cards",
      args,
      responseKind: "success",
      resultCount: totalEntries,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    });

    console.log(
      `[tool-trace] adp_get_time_cards coworker=${ctx.coworkerId} workerId=${args.workerId} timeCards=${mapped.length} entries=${totalEntries} duration=${Date.now() - startedAt}ms`,
    );

    return result;
  } catch (err) {
    const { errorCode, errorMessage, responseKind } = classifyError(err);
    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_get_time_cards",
      args,
      responseKind,
      resultCount: null,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
    });
    console.log(
      `[tool-trace] adp_get_time_cards coworker=${ctx.coworkerId} kind=${responseKind} code=${errorCode} duration=${Date.now() - startedAt}ms`,
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
  name: "adp_get_time_cards",
  description:
    "Retrieve time cards for a single worker in a pay period. Returns each time card with per-day entries (date, hoursWorked, positionCode, notes). Free-text notes fields are scanned for prompt-injection patterns before reaching the LLM; matching sentences are scrubbed and suspiciousContentDetected is flagged on the result.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workerId: {
        type: "string",
        description: "ADP worker ID — 3-64 alphanumeric/_/- characters",
      },
      payPeriodStart: { type: "string", description: "Pay period start (YYYY-MM-DD)" },
      payPeriodEnd: { type: "string", description: "Pay period end (YYYY-MM-DD). Range must be ≤ 93 days." },
    },
    required: ["workerId", "payPeriodStart", "payPeriodEnd"],
    additionalProperties: false,
  },
};
