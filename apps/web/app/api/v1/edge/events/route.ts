// POST /api/v1/edge/events — accept a batch of PD-CEF-style events from
// edge-side detectors and route each to its persistence path by eventType.
//
// Slice 0 of the edge-node detection engine (BI-9FE9D48D) defined the
// alert path. Slice 1 (BI-8405FDA5) adds the change path: eventType
// discriminator on the wire selects EdgeEvent (default, full lifecycle)
// vs. ChangeEvent (point-in-time, no lifecycle).
// Specs:
//   docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md
//   docs/superpowers/specs/2026-05-21-edge-change-events-design.md
//
// Order of operations (matches /api/v1/edge/metrics):
//   1. Body size cap (256 KB — events allow up to 500 records with details)
//   2. Auth (edge:events scope, trustState=trusted)
//   3. JSON parse
//   4. Zod envelope validation (returns 422 on shape drift)
//   5. Freshness window (5 min past, 5 min future)
//   6. Per-node rate limit (edge.events.submit)
//   7. Per-event dispatch on eventType:
//        "alert"  (default) — upsert EdgeEvent on (edgeNodeId, dedupKey);
//                             action drives the triggered/ack/resolved
//                             lifecycle
//        "change"           — upsert ChangeEvent on (edgeNodeId, dedupKey);
//                             point-in-time fact, no lifecycle, action
//                             accepted but ignored
//
// Alert lifecycle on replay:
//   action="trigger"     — new row, or re-open resolved row (resolvedAt
//                          cleared, occurrenceCount incremented, severity/
//                          summary/customDetails refreshed)
//   action="acknowledge" — status="acknowledged" (does not reset occurrenceCount)
//   action="resolve"     — status="resolved", resolvedAt=now
//
// Change replay: same (edgeNodeId, changeKey) — update summary +
// customDetails + lastSeenAt; firstSeenAt preserved. No occurrenceCount,
// no resolved/reopened distinction.
//
// nodeId always derived from the bearer token; the body nodeId field is
// informational only.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import { edgeEventEnvelopeSchema, type EdgeEvent } from "@dpf/validators";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { checkEdgeRateLimit } from "@/lib/edge-node/rate-limit";

const BODY_SIZE_CAP_BYTES = 256 * 1024; // 256 KB — generous for batched events
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ROUTE_CONTEXT = "/api/v1/edge/events";

type IngestSummary = {
  created: number;
  reopened: number;
  acknowledged: number;
  resolved: number;
  updated: number; // existing rows whose trigger replay only bumped counters
  // Slice 1: ChangeEvent rows inserted or updated. Not split by created vs
  // updated because changes have no meaningful "re-opened" semantics and the
  // operator-facing distinction is low value at this layer.
  changes: number;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Body size cap (before auth — avoid large JSON.parse on denial).
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > BODY_SIZE_CAP_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: "payload_too_large",
        maxBytes: BODY_SIZE_CAP_BYTES,
      },
      { status: 413 },
    );
  }

  // 2. Auth (scope=edge:events; requires trustState=trusted).
  const authResult = await resolveEdgeNodeAuth(
    request.headers.get("authorization"),
    "edge:events",
  );
  if (!authResult.ok) {
    const status = authResult.error === "scope_disallowed" ? 403 : 401;
    return NextResponse.json(
      { ok: false, error: authResult.error, message: authResult.message },
      { status },
    );
  }
  const { nodeId, edgeNodeRowId } = authResult;

  // 3. Parse body (guarded by size cap above).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  // 4. Validate envelope shape.
  const parsed = edgeEventEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_envelope",
        issues: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  // 5. Freshness check (symmetric 5-min window — events should be near
  // real-time. Detectors that buffer offline should bump observedAt
  // when flushing, not preserve the original instant; the per-event
  // occurredAt preserves the original detection time).
  const observedAgeMs = Math.abs(
    Date.now() - new Date(parsed.data.observedAt).getTime(),
  );
  if (observedAgeMs > FRESHNESS_WINDOW_MS) {
    return NextResponse.json(
      {
        ok: false,
        error: "stale_payload",
        message: `observedAt is ${Math.round(observedAgeMs / 1000)} s from server time; max ${FRESHNESS_WINDOW_MS / 1000} s`,
      },
      { status: 422 },
    );
  }

  // 6. Rate limit (per-node, per-route).
  const rate = checkEdgeRateLimit("edge.events.submit", nodeId);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        retryAfterSec: rate.retryAfter,
      },
      {
        status: 429,
        headers: rate.retryAfter
          ? { "Retry-After": String(rate.retryAfter) }
          : {},
      },
    );
  }

  // 7. Persist. One transaction per request keeps the batch atomic from
  // the operator's perspective — a partial failure shouldn't leave the
  // dashboard half-updated.
  const summary: IngestSummary = {
    created: 0,
    reopened: 0,
    acknowledged: 0,
    resolved: 0,
    updated: 0,
    changes: 0,
  };

  try {
    await prisma.$transaction(async (tx) => {
      for (const ev of parsed.data.events) {
        // Slice 1 (BI-8405FDA5): dispatch by eventType. The Zod default of
        // "alert" guarantees ev.eventType is always set after parsing, so
        // a bare equality check is safe; existing Slice 0 producers omit
        // the field and land on the alert branch unchanged.
        if (ev.eventType === "change") {
          await ingestChange(tx, edgeNodeRowId, ev, summary);
        } else {
          await ingestOne(tx, edgeNodeRowId, ev, summary);
        }
      }
    });
  } catch (err) {
    // Surface a generic 500 — Prisma errors here are infra-level (DB
    // down, FK violation from a deleted node mid-request). The detector
    // will retry the batch with the same RunKey; idempotency keeps the
    // counts honest because each event upsert is a no-op replay.
    return NextResponse.json(
      {
        ok: false,
        error: "persist_failed",
        message: err instanceof Error ? err.message : "unknown persistence error",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      runKey: parsed.data.runKey,
      nodeId,
      accepted: parsed.data.events.length,
      ...summary,
      remaining: rate.remaining,
      route: ROUTE_CONTEXT,
    },
    { status: 200 },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ingestOne — upsert one event by (edgeNodeId, dedupKey) and translate the
// submitted action into a status transition. Uses prisma.upsert so the
// happy path is a single statement; the read-then-write inside is fine
// because the surrounding transaction holds the row.
// ──────────────────────────────────────────────────────────────────────────
async function ingestOne(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  edgeNodeId: string,
  ev: EdgeEvent,
  summary: IngestSummary,
): Promise<void> {
  const now = new Date();
  const occurredAt = new Date(ev.occurredAt);

  const existing = await tx.edgeEvent.findUnique({
    where: { edgeNodeId_dedupKey: { edgeNodeId, dedupKey: ev.dedupKey } },
    select: { id: true, status: true, occurrenceCount: true },
  });

  // customDetails is a JSON column; Prisma wants the literal value, not
  // `undefined`, when we mean "leave existing intact". Use null-coalesce
  // to keep the field absent rather than null.
  const customDetailsValue =
    ev.customDetails === undefined ? undefined : (ev.customDetails as object);

  if (!existing) {
    const status = statusFromAction(ev.action);
    await tx.edgeEvent.create({
      data: {
        edgeNodeId,
        dedupKey: ev.dedupKey,
        source: ev.source,
        component: ev.component ?? null,
        eventGroup: ev.eventGroup ?? null,
        eventClass: ev.eventClass ?? null,
        severity: ev.severity,
        status,
        action: ev.action,
        summary: ev.summary,
        customDetails: customDetailsValue,
        occurredAt,
        firstSeenAt: now,
        lastSeenAt: now,
        resolvedAt: ev.action === "resolve" ? now : null,
        occurrenceCount: 1,
      },
    });
    summary.created++;
    if (ev.action === "acknowledge") summary.acknowledged++;
    else if (ev.action === "resolve") summary.resolved++;
    return;
  }

  switch (ev.action) {
    case "trigger": {
      // Re-open if previously resolved; otherwise just bump counters and
      // refresh the payload. occurrenceCount counts every trigger, since
      // edge-side dedup already collapsed flap noise — a count here means
      // the condition genuinely re-fired after a portal-observed gap.
      const reopen = existing.status === "resolved";
      await tx.edgeEvent.update({
        where: { id: existing.id },
        data: {
          source: ev.source,
          component: ev.component ?? null,
          eventGroup: ev.eventGroup ?? null,
          eventClass: ev.eventClass ?? null,
          severity: ev.severity,
          status: "triggered",
          action: "trigger",
          summary: ev.summary,
          customDetails: customDetailsValue,
          occurredAt,
          lastSeenAt: now,
          resolvedAt: reopen ? null : undefined,
          occurrenceCount: existing.occurrenceCount + 1,
        },
      });
      if (reopen) summary.reopened++;
      else summary.updated++;
      return;
    }
    case "acknowledge": {
      await tx.edgeEvent.update({
        where: { id: existing.id },
        data: {
          status: "acknowledged",
          action: "acknowledge",
          summary: ev.summary,
          customDetails: customDetailsValue,
          lastSeenAt: now,
        },
      });
      summary.acknowledged++;
      return;
    }
    case "resolve": {
      await tx.edgeEvent.update({
        where: { id: existing.id },
        data: {
          status: "resolved",
          action: "resolve",
          summary: ev.summary,
          customDetails: customDetailsValue,
          lastSeenAt: now,
          resolvedAt: now,
        },
      });
      summary.resolved++;
      return;
    }
  }
}

function statusFromAction(action: EdgeEvent["action"]): string {
  switch (action) {
    case "trigger":
      return "triggered";
    case "acknowledge":
      return "acknowledged";
    case "resolve":
      return "resolved";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ingestChange — Slice 1: upsert a point-in-time change record by
// (edgeNodeId, changeKey). Changes have no lifecycle — `action` is required
// by the wire schema for envelope uniformity but ignored here. Re-submission
// of the same changeKey updates summary + customDetails + lastSeenAt while
// preserving firstSeenAt; the upstream emitter is expected to use a stable
// identifier (git SHA, deploy ID, change-ticket ref) so retries collapse
// rather than duplicating rows.
// ──────────────────────────────────────────────────────────────────────────
async function ingestChange(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  edgeNodeId: string,
  ev: EdgeEvent,
  summary: IngestSummary,
): Promise<void> {
  const now = new Date();
  const occurredAt = new Date(ev.occurredAt);
  const customDetailsValue =
    ev.customDetails === undefined ? undefined : (ev.customDetails as object);

  await tx.changeEvent.upsert({
    where: {
      edgeNodeId_changeKey: { edgeNodeId, changeKey: ev.dedupKey },
    },
    create: {
      edgeNodeId,
      changeKey: ev.dedupKey,
      source: ev.source,
      component: ev.component ?? null,
      eventGroup: ev.eventGroup ?? null,
      eventClass: ev.eventClass ?? null,
      severity: ev.severity,
      summary: ev.summary,
      customDetails: customDetailsValue,
      occurredAt,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      // Refresh the operator-visible fields on replay so an emitter can
      // amend a change (e.g. post-deploy verification status) without
      // needing a separate route.
      source: ev.source,
      component: ev.component ?? null,
      eventGroup: ev.eventGroup ?? null,
      eventClass: ev.eventClass ?? null,
      severity: ev.severity,
      summary: ev.summary,
      customDetails: customDetailsValue,
      lastSeenAt: now,
      // firstSeenAt + occurredAt intentionally NOT refreshed — they pin
      // the original observation in time, which is what the correlation
      // engine cares about.
    },
  });
  summary.changes++;
}
