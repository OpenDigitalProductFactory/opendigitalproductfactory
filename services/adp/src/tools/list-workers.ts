// adp_list_workers — MCP tool returning active workers with SSN redaction.

import { z } from "zod";
import { getSql } from "../lib/db.js";
import { getActiveCredential, recordToolCall, AdpNotConnectedError } from "../lib/creds.js";
import { adpGet, AdpApiError } from "../lib/adp-client.js";
import { redact } from "../lib/redact.js";

export const ListWorkersArgsSchema = z
  .object({
    // Optional filter — if omitted, returns a first page of active workers.
    statusFilter: z.enum(["Active", "Inactive", "Terminated", "Leave"]).optional(),
    top: z.number().int().min(1).max(100).optional(),
    skip: z.number().int().min(0).optional(),
  })
  .strict();

export type ListWorkersArgs = z.infer<typeof ListWorkersArgsSchema>;

export interface ListedWorker {
  workerId: string;
  associateOID: string;
  displayName: string;
  employeeNumber: string | null;
  positionTitle: string | null;
  departmentCode: string | null;
  hireDate: string | null;
  status: string | null;
}

export interface ListWorkersResult {
  workers: ListedWorker[];
  suspiciousContentDetected: boolean;
  nextSkip: number | null;
}

// Shape we consume from ADP's /hr/v2/workers endpoint. Fields not listed here
// are tolerated (ADP returns much more); we cherry-pick what the Payroll
// Specialist coworker needs and drop the rest to keep LLM context lean.
interface AdpWorkersResponse {
  workers: Array<{
    associateOID: string;
    workerID?: { idValue?: string };
    person?: {
      legalName?: { givenName?: string; familyName?: string };
    };
    workAssignments?: Array<{
      positionTitle?: string;
      hireDate?: string;
      assignmentStatus?: { statusCode?: { codeValue?: string } };
      homeOrganizationalUnits?: Array<{
        nameCode?: { codeValue?: string };
      }>;
      primaryIndicator?: boolean;
    }>;
  }>;
}

export interface ListWorkersContext {
  coworkerId: string;
  userId: string | null;
}

export async function listWorkers(
  rawArgs: unknown,
  ctx: ListWorkersContext,
): Promise<ListWorkersResult> {
  const args = ListWorkersArgsSchema.parse(rawArgs);
  const sql = getSql();
  const startedAt = Date.now();

  try {
    const credential = await getActiveCredential(sql);

    const response = await adpGet<AdpWorkersResponse>({
      credential,
      path: "/hr/v2/workers",
      query: {
        ...(args.statusFilter
          ? { $filter: `workAssignments/assignmentStatus/statusCode/codeValue eq '${args.statusFilter}'` }
          : {}),
        ...(args.top !== undefined ? { $top: args.top } : { $top: 50 }),
        ...(args.skip !== undefined ? { $skip: args.skip } : {}),
      },
    });

    const mapped: ListedWorker[] = (response.workers ?? []).map((w) => {
      const primaryAssignment = (w.workAssignments ?? []).find((a) => a.primaryIndicator)
        ?? w.workAssignments?.[0];
      const given = w.person?.legalName?.givenName ?? "";
      const family = w.person?.legalName?.familyName ?? "";
      return {
        workerId: w.workerID?.idValue ?? w.associateOID,
        associateOID: w.associateOID,
        displayName: `${given} ${family}`.trim(),
        employeeNumber: w.workerID?.idValue ?? null,
        positionTitle: primaryAssignment?.positionTitle ?? null,
        departmentCode:
          primaryAssignment?.homeOrganizationalUnits?.[0]?.nameCode?.codeValue ?? null,
        hireDate: primaryAssignment?.hireDate ?? null,
        status: primaryAssignment?.assignmentStatus?.statusCode?.codeValue ?? null,
      };
    });

    const redacted = redact({ workers: mapped });

    const requestedTop = args.top ?? 50;
    const nextSkip = mapped.length >= requestedTop ? (args.skip ?? 0) + mapped.length : null;

    const result: ListWorkersResult = {
      workers: redacted.value.workers,
      suspiciousContentDetected: redacted.suspiciousContentDetected,
      nextSkip,
    };

    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_list_workers",
      args,
      responseKind: "success",
      resultCount: mapped.length,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    });

    console.log(
      `[tool-trace] adp_list_workers coworker=${ctx.coworkerId} resultCount=${mapped.length} duration=${Date.now() - startedAt}ms`,
    );

    return result;
  } catch (err) {
    const { errorCode, errorMessage, responseKind } = classifyError(err);
    await recordToolCall(sql, {
      coworkerId: ctx.coworkerId,
      userId: ctx.userId,
      toolName: "adp_list_workers",
      args,
      responseKind,
      resultCount: null,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
    });
    console.log(
      `[tool-trace] adp_list_workers coworker=${ctx.coworkerId} kind=${responseKind} code=${errorCode} duration=${Date.now() - startedAt}ms`,
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
  name: "adp_list_workers",
  description:
    "List active workers from ADP Workforce Now. Returns paginated worker summaries with displayName, employeeNumber, positionTitle, departmentCode, hireDate, and status. SSN and other PII are redacted before reaching the LLM. Use statusFilter='Active' to limit to current employees.",
  inputSchema: {
    type: "object" as const,
    properties: {
      statusFilter: {
        type: "string",
        enum: ["Active", "Inactive", "Terminated", "Leave"],
        description: "Filter by assignment status",
      },
      top: { type: "number", minimum: 1, maximum: 100, description: "Page size (default 50, max 100)" },
      skip: { type: "number", minimum: 0, description: "Skip offset for pagination" },
    },
    additionalProperties: false,
  },
};
