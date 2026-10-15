// POST /api/workbooks/export?format=xlsx|ods — the Workbooks grid's office
// export (BI-4865EB4D). The body is the view the grid shows (a
// WorkbookExportModel: columns, rows, rules, chart view); the answer is the
// .xlsx or .ods file the document engine made from it.
//
// The body carries only data the caller already holds on screen, so the route
// reads nothing from the database; a signed-in session is the whole check.
// A 503 with reason "converter-unavailable" tells the grid to fall back to its
// data-only .xlsx writer.
// @exposure authenticated

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { exportWorkbook, isWorkbookExportFormat, parseWorkbookExportModel } from "@/lib/workbooks/export-workbook";

export const runtime = "nodejs";

/** Grid rows are capped at MAX_GRID_ROWS; this bounds the JSON that carries them. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const FAILURE_STATUS: Readonly<Record<string, number>> = {
  "converter-unavailable": 503,
  "input-too-large": 413,
  timeout: 504,
  "conversion-failed": 422,
};

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiErrorResponse("UNAUTHORIZED", "Sign in to export.", 401);

  const format = new URL(request.url).searchParams.get("format");
  if (!isWorkbookExportFormat(format)) return apiErrorResponse("BAD_REQUEST", "Export to xlsx or ods.", 400);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return apiErrorResponse("PAYLOAD_TOO_LARGE", "This view is too large to export.", 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return apiErrorResponse("PAYLOAD_TOO_LARGE", "This view is too large to export.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiErrorResponse("BAD_REQUEST", "The export request is not valid JSON.", 400);
  }
  const model = parseWorkbookExportModel(body);
  if (!model.ok) return apiErrorResponse("BAD_REQUEST", model.error, 400);

  const out = await exportWorkbook(model.data, format);
  if (!out.ok) {
    const status = FAILURE_STATUS[out.reason] ?? 422;
    return apiErrorResponse(out.reason === "converter-unavailable" ? "SERVICE_UNAVAILABLE" : "EXPORT_FAILED", out.error, status, {
      reason: out.reason,
    });
  }
  const { bytes, mimeType, filename } = out.data;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
