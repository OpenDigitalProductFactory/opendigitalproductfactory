import { prisma } from "@dpf/db";

export async function POST(request: Request) {
  try {
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 65536) {
      return Response.json({ ok: false, error: "Too large" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();

    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: String(body.type ?? "user_report").slice(0, 50),
        severity: String(body.severity ?? "medium").slice(0, 20),
        title: String(body.title ?? "Untitled report").slice(0, 500),
        description: body.description ? String(body.description).slice(0, 10000) : null,
        routeContext: body.routeContext ? String(body.routeContext).slice(0, 500) : null,
        errorStack: body.errorStack ? String(body.errorStack).slice(0, 20000) : null,
        userAgent: body.userAgent ? String(body.userAgent).slice(0, 500) : null,
        reportedById: typeof body.userId === "string" ? body.userId : null,
        source: String(body.source ?? "manual").slice(0, 30),
        portfolioId: typeof body.portfolioId === "string" ? body.portfolioId : null,
        digitalProductId: typeof body.digitalProductId === "string" ? body.digitalProductId : null,
      },
    });
    return Response.json({ ok: true, reportId });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
