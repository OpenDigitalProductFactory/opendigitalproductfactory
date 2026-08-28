import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAppBaseUrl } from "@/lib/app-url";
import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { writeEdgeNodeAudit } from "@/lib/edge-node/audit";
import { checkEdgeRateLimit } from "@/lib/edge-node/rate-limit";
import {
  isLinkLocalFederationEndpoint,
  recordNearbyFederationCandidates,
} from "@/lib/federation/nearby-candidates";

const ROUTE_CONTEXT = "/api/v1/edge/federation-candidates";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const Candidate = z
  .object({
    discoveryId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    endpoint: z
      .string()
      .url()
      .max(512)
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "endpoint must use HTTP or HTTPS"),
    protocol: z.literal("1"),
    capabilityDigest: z.string().regex(/^[a-f0-9]{8,64}$/),
    pairPath: z.literal("/connect/pair"),
    // The estate the peer advertises in its discovery record. Optional so an
    // Edge Node that predates the field keeps submitting successfully; the
    // decision layer treats an absent ref as "cannot prove same organization"
    // and routes that pairing to a human. Bounded here and normalised in
    // `recordNearbyFederationCandidates`; never trusted on its own, because the
    // same decision also requires a certificate chain validating against the
    // pinned organization root.
    organizationRef: z.string().min(1).max(48).optional(),
  })
  .strict()
  .refine((value) => isLinkLocalFederationEndpoint(value.endpoint), {
    message: "endpoint must be link-local or private-network scoped",
    path: ["endpoint"],
  });

const Body = z
  .object({
    observedAt: z.string().datetime(),
    candidates: z.array(Candidate).max(50),
  })
  .strict();

function authStatus(error: string): number {
  return error === "scope_disallowed" ? 403 : 401;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const auth = await resolveEdgeNodeAuth(
    request.headers.get("authorization"),
    "discovery:submit",
  );
  if (!auth.ok) {
    const status = authStatus(auth.error);
    await writeEdgeNodeAudit({
      route: "edge.federation_candidates.submit",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status,
      success: false,
      error: auth.error,
      summary: { scope: "discovery:submit" },
    });
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status },
    );
  }

  const rateLimit = checkEdgeRateLimit(
    "edge.federation_candidates.submit",
    auth.edgeNodeRowId,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
      },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413 },
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413 },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(decoded);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_candidate_snapshot" },
      { status: 400 },
    );
  }

  const now = new Date();
  const observedAt = new Date(parsed.data.observedAt);
  if (Math.abs(now.getTime() - observedAt.getTime()) > MAX_CLOCK_SKEW_MS) {
    return NextResponse.json(
      { ok: false, error: "stale_candidate_snapshot" },
      { status: 400 },
    );
  }

  recordNearbyFederationCandidates({
    edgeNodeId: auth.edgeNodeRowId,
    observedAt,
    candidates: parsed.data.candidates,
    localAuthorityUrl: resolveAppBaseUrl() || undefined,
    now,
  });
  await writeEdgeNodeAudit({
    route: "edge.federation_candidates.submit",
    routeContext: ROUTE_CONTEXT,
    startedAt,
    edgeNodeId: auth.edgeNodeRowId,
    nodeId: auth.nodeId,
    principalId: null,
    status: 202,
    success: true,
    summary: { candidateCount: parsed.data.candidates.length },
  });
  return NextResponse.json(
    { ok: true, accepted: parsed.data.candidates.length, trustedLinksCreated: 0 },
    { status: 202 },
  );
}
