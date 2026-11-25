/**
 * Internal quiescence-state endpoint — Node runtime.
 *
 * Returns the current quiescence level for the Proxy to consult on every
 * request. The Proxy runs at Next.js Edge runtime and cannot import Prisma
 * directly; this route is the bridge.
 *
 * The base shape is sessionless because the Proxy reads it over loopback.
 * Its quiescence allowlist is not an authorization check. The banner's
 * opt-in deadline display requires a signed-in session at this handler.
 *
 * Note: this route is intentionally excluded from the Proxy's quiescence
 * gate (the gate would recursively try to fetch state about itself).
 * That exclusion lives in apps/web/lib/proxy/quiescence-gate.ts.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §6.4
 * BI-QUIESCE-003.
 */
import { NextResponse } from "next/server";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";

export const runtime = "nodejs";
// Always evaluate at request time — quiescence state changes during the
// runtime and stale caching here would invalidate the entire protocol.
export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  try {
    const displayRequested = request && new URL(request.url).searchParams.get("display") === "1";
    if (displayRequested && !(await auth())?.user) return apiErrorResponse("UNAUTHORIZED", "Sign in to read the maintenance deadline.", 401);
    const config = await getQuiescenceConfig();
    const sha = await getDeployedSha();
    // Ordinary edge admission lookups keep their existing single cached read.
    const display = displayRequested && config.runId && config.level !== "normal"
      ? await prisma.quiescenceRun.findUnique({
        where: { runId: config.runId, trigger: "self-upgrade", status: { in: ["ready-to-swap", "swapping"] }, abortRequestedAt: null },
        select: { readyToSwapDeadlineAt: true, swapStartedAt: true },
      })
      : null;
    return NextResponse.json(
      {
        level: config.level,
        runId: config.runId,
        enteredAt: config.enteredAt,
        ...(display?.readyToSwapDeadlineAt ? {
          readyToSwapDeadlineAt: display.readyToSwapDeadlineAt.toISOString(),
          swapStarted: !!display.swapStartedAt,
        } : {}),
        version: process.env.PORTAL_VERSION ?? "unknown",
        bundleHash: sha ?? "unknown",
      },
      {
        headers: {
          // No HTTP caching — the Proxy maintains its own in-memory cache
          // with a 1s TTL; HTTP cache would be wrong because operator state
          // flips happen at sub-second granularity.
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (err) {
    // The fetch must never crash the Proxy. On any error, return a
    // recognizable shape so the Proxy's failure-mode logic can apply the
    // §6.4 fail-open/closed policy (read=open, mutation=preserve last
    // known non-normal).
    return NextResponse.json(
      {
        error: getErrorMessage(err),
        // Default-to-normal on the wire; the Proxy's policy is the
        // authority on what fail-open vs fail-closed means in context.
        level: "normal",
        runId: null,
        enteredAt: null,
        version: process.env.PORTAL_VERSION ?? "unknown",
        bundleHash: "unknown",
      },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
