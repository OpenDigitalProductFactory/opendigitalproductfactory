// GET /api/health — readiness probe.
//
// This endpoint is consumed by load balancers / uptime monitors / the
// self-upgrade quiescence gate as a real health signal, so it must verify the
// hard dependencies the portal cannot serve without — not merely prove the
// Node process can answer. A failed dependency returns HTTP 503 so callers can
// route around an unhealthy instance.
//
// BI-9F106818 Phase 0: also checks event-loop liveness. A background sweep
// that monopolises the event loop makes the portal unresponsive while Docker
// still reports "healthy" (its check only tests TCP + this route). A 2-second
// setTimeout probe detects a wedged loop and returns 503 so Docker restarts
// the container automatically rather than silently serving a hung process.

import { prisma } from "@dpf/db";

/** Measure event-loop lag by scheduling a zero-delay timer and recording
 *  how late it actually fires. Healthy portals resolve in <50ms; a loop
 *  wedged by a heavy discovery sweep takes seconds.
 */
function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    setTimeout(() => resolve(Date.now() - start), 0);
  });
}

// 2 000 ms: aggressive enough to catch a genuinely wedged loop, conservative
// enough to never false-positive on a briefly busy-but-healthy process.
// Override with EVENT_LOOP_LAG_THRESHOLD_MS for non-default environments.
// Read per-request so tests and runtime config changes take effect immediately.
function getEventLoopLagThreshold(): number {
  return Number(process.env["EVENT_LOOP_LAG_THRESHOLD_MS"]) || 2000;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const lagThresholdMs = getEventLoopLagThreshold();

  // Check event-loop liveness FIRST (before the DB query, which would also
  // block if the loop is wedged — making the probe itself unreliable).
  const lagMs = await measureEventLoopLag();
  if (lagMs >= lagThresholdMs) {
    return Response.json(
      {
        status: "degraded",
        checks: { database: "unknown", eventLoop: "lagging" },
        error: `Event loop lag ${lagMs}ms exceeds threshold ${lagThresholdMs}ms`,
        lagMs,
        timestamp,
      },
      { status: 503 },
    );
  }

  try {
    // The one hard dependency every request path needs: the database.
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      checks: { database: "ok", eventLoop: "ok" },
      lagMs,
      timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "database unreachable";
    return Response.json(
      {
        status: "degraded",
        checks: { database: "error", eventLoop: "ok" },
        error: message,
        lagMs,
        timestamp,
      },
      { status: 503 },
    );
  }
}
