// GET /api/health — readiness probe.
//
// This endpoint is consumed by load balancers / uptime monitors / the
// self-upgrade quiescence gate as a real health signal, so it must verify the
// hard dependencies the portal cannot serve without — not merely prove the
// Node process can answer. A failed dependency returns HTTP 503 so callers can
// route around an unhealthy instance.

import { prisma } from "@dpf/db";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    // The one hard dependency every request path needs: the database.
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", checks: { database: "ok" }, timestamp });
  } catch (error) {
    const message = error instanceof Error ? error.message : "database unreachable";
    return Response.json(
      { status: "degraded", checks: { database: "error" }, error: message, timestamp },
      { status: 503 },
    );
  }
}
