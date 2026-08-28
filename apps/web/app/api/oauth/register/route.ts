// @exposure public — RFC 7591 dynamic client registration. Registration grants no authority; it is policy-gated to loopback by default.
// POST /api/oauth/register — RFC 7591 Dynamic Client Registration.
//
// Enabled by default ONLY when this install's origin is loopback (§7.3). The
// reasoning: registration alone grants nothing — every token still requires an
// authenticated human to consent — but an open /register on a reachable
// install is a junk-row and phishing-surface vector, because a self-registered
// client picks its own display name. The consent screen marks DCR clients as
// self-asserted for exactly that reason.
//
// DCR exists here because Client ID Metadata Documents cannot work on an
// air-gapped install: a CIMD client_id is an https URL the AS must fetch. The
// spec calls DCR a backwards-compatibility mechanism; for a fully-local DPF it
// is the only mechanism that functions.


// Error bodies here are RFC 6749 §5.2 shaped ({ error, error_description }),
// NOT the platform apiErrorResponse shape ({ code, message }). An OAuth client
// parses `error` to decide what to do next — re-authorize, step up, or give up —
// so emitting `code` instead would break the protocol for every conformant
// client. This is the one place the house error contract must yield to the wire
// contract; the raw-route-error baseline records it deliberately.

import { NextResponse } from "next/server";
import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { isDcrEnabled } from "@/lib/auth/oauth-policy";
import { registerDynamicClient } from "@/lib/auth/oauth-clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "No resolvable public URL." },
      { status: 503 },
    );
  }
  if (!isDcrEnabled(origin)) {
    return NextResponse.json(
      {
        error: "access_denied",
        error_description:
          "Dynamic client registration is disabled on this installation. Register the client in Admin > Platform Development, or use a Client ID Metadata Document.",
      },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON." },
      { status: 400 },
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim()
      : "Unnamed MCP client";

  const result = await registerDynamicClient({ clientName, redirectUris, metadata: body });
  if (!result.registered) {
    return NextResponse.json(
      { error: result.error, error_description: result.detail },
      { status: 400 },
    );
  }

  // RFC 7591 §3.2.1: 201 with the registered metadata. No client_secret — a
  // dynamically registered MCP client is public and authenticates with PKCE.
  return NextResponse.json(
    {
      client_id: result.clientId,
      client_name: result.clientName,
      redirect_uris: result.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
