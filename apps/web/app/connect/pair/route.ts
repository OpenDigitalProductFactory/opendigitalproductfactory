import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { resolveFederationIdentity } from "@/lib/federation/demand-identity";
import {
  createIncomingNearbyPairing,
  pollIncomingNearbyPairing,
} from "@/lib/federation/nearby-pairing-service";
import { checkNearbyPairingRateLimit } from "@/lib/federation/nearby-pairing-rate-limit";

const MAX_BODY_BYTES = 8 * 1024;

function requesterKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || real || "unknown";
  return value.length <= 80 ? value : value.slice(0, 80);
}

function error(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return error(413, "payload_too_large", "Pairing request is too large.");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return error(400, "invalid_body", "Pairing request could not be read.");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return error(413, "payload_too_large", "Pairing request is too large.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return error(400, "invalid_json", "Pairing request must be valid JSON.");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return error(400, "invalid_request", "Pairing request must be an object.");
  }
  const { operation, ...payload } = decoded as Record<string, unknown>;
  const rateClass = operation === "poll" ? "poll" : "request";
  const perRequesterLimit = rateClass === "poll" ? 60 : 10;
  const globalLimit = rateClass === "poll" ? 600 : 100;
  const globalRateLimit = checkNearbyPairingRateLimit(`global:${rateClass}`, {
    maxRequests: globalLimit,
  });
  const requesterRateLimit = globalRateLimit.allowed
    ? checkNearbyPairingRateLimit(`${rateClass}:${requesterKey(request)}`, {
        maxRequests: perRequesterLimit,
      })
    : globalRateLimit;
  if (!requesterRateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", message: "Too many pairing requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(requesterRateLimit.retryAfterSeconds) } },
    );
  }

  if (operation === "request") {
    try {
      const [identity, organization] = await Promise.all([
        resolveFederationIdentity(prisma),
        prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true } }),
      ]);
      const result = await createIncomingNearbyPairing(payload, {
        localDisplayName: organization?.name?.trim() || "Nearby DPF installation",
        localInstallationId: identity.installationId,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (caught) {
      return error(
        400,
        "invalid_request",
        caught instanceof Error ? caught.message : "Pairing request is invalid.",
      );
    }
  }

  if (operation === "poll") {
    const pairingId = payload.pairingId;
    const pairingSecret = payload.pairingSecret;
    if (
      Object.keys(payload).some((key) => key !== "pairingId" && key !== "pairingSecret") ||
      typeof pairingId !== "string" ||
      !/^pair_[A-Za-z0-9_-]{3,160}$/.test(pairingId) ||
      typeof pairingSecret !== "string" ||
      !/^dpffpair_[A-Za-z0-9_-]{40,80}$/.test(pairingSecret)
    ) {
      return error(400, "invalid_request", "Pairing poll is invalid.");
    }
    const result = await pollIncomingNearbyPairing({ pairingId, pairingSecret });
    if (!result.ok) {
      return result.error === "not_found"
        ? error(404, result.error, "Pairing session was not found.")
        : error(503, result.error, "Pairing credential is temporarily unavailable.");
    }
    return NextResponse.json(result);
  }

  return error(400, "unsupported_operation", "Use request or poll.");
}
