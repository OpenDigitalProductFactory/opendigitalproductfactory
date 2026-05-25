import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";

export async function POST(request: Request): Promise<Response> {
  try {
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 65536) {
      return Response.json({ ok: false, error: "Too large" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const { reportId } = await createPlatformIssueReport({
      type: String(body.type ?? "user_report"),
      title: String(body.title ?? "Untitled report"),
      source: String(body.source ?? "manual"),
      severity: typeof body.severity === "string" ? body.severity : "medium",
      description: typeof body.description === "string" ? body.description : null,
      routeContext: typeof body.routeContext === "string" ? body.routeContext : null,
      errorStack: typeof body.errorStack === "string" ? body.errorStack : null,
      userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
      reportedById: typeof body.userId === "string" ? body.userId : null,
      portfolioId: typeof body.portfolioId === "string" ? body.portfolioId : null,
      digitalProductId: typeof body.digitalProductId === "string" ? body.digitalProductId : null,
    });

    return Response.json({ ok: true, reportId });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
