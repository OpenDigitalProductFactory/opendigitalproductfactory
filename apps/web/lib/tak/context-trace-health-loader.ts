// apps/web/lib/tak/context-trace-health-loader.ts
//
// Thin read path for the context-trace health projection. Kept separate from the pure
// aggregation (context-trace-health.ts) so the arithmetic is unit-tested without Prisma
// and this file stays a query with no logic worth hiding.

import { prisma, Prisma } from "@dpf/db";

import { summarizeContextTraces, type ContextTraceHealth } from "./context-trace-health";

/**
 * How many recent traced turns to sample.
 *
 * Bounded on purpose: this is a diagnostic panel on an admin page, not an analytics
 * warehouse. An unbounded scan of AgentMessage would be the exact unbounded-result
 * mistake the tool-result budget exists to prevent, on the read side.
 */
export const CONTEXT_TRACE_SAMPLE_SIZE = 200;

/**
 * Load the most recent traced turns and project their health.
 *
 * Only rows that actually arbitrated carry a trace, so `contextTrace: { not: null }` is
 * the sample — turns on the legacy prompt path are absent by design, and the projection
 * reports "no turns recorded a trace" rather than implying nothing was lost.
 *
 * Never throws into the page: a diagnostic panel must not be able to take down the
 * runtime-health surface it lives on.
 */
export async function loadContextTraceHealth(
  sampleSize: number = CONTEXT_TRACE_SAMPLE_SIZE,
): Promise<ContextTraceHealth> {
  try {
    const rows = await prisma.agentMessage.findMany({
      // `Prisma.DbNull`, not a plain `null`: on a nullable Json column Prisma
      // distinguishes SQL NULL from the JSON value `null`, and rejects a bare `null`
      // here. Caught by typecheck — the runtime behaviour of getting this wrong is a
      // filter that silently matches nothing.
      where: { contextTrace: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: sampleSize,
      select: { contextTrace: true },
    });
    return summarizeContextTraces(rows.map((r: { contextTrace: unknown }) => r.contextTrace));
  } catch {
    return summarizeContextTraces([]);
  }
}
