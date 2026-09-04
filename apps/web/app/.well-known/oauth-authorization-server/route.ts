// @exposure public — RFC 8414 metadata. Public by definition — a client must read it BEFORE it can authenticate.
// GET /.well-known/oauth-authorization-server
//
// RFC 8414 Authorization Server Metadata. MCP `2025-11-25` requires an
// authorization server to offer this or OIDC Discovery
// (`authorization.mdx:66-70`); DPF offers this one, because the portal is its
// own authorization server and is not an OIDC provider.
//
// The document advertises S256 as the only PKCE method (OAuth 2.1 removes
// `plain`, and advertising it would invite a downgrade), and includes
// `registration_endpoint` only when Dynamic Client Registration is actually
// enabled for this origin — advertising an endpoint that refuses every request
// is worse than omitting it, because the spec's client priority order
// (`authorization.mdx:204-209`) keys off its presence.


import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/error";
import { buildAuthorizationServerMetadata, resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { isDcrEnabled } from "@/lib/auth/oauth-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return apiErrorResponse(
      "NOT_CONFIGURED",
      "This install has no configured public URL, so it cannot advertise an authorization server.",
      404,
    );
  }
  return NextResponse.json(
    buildAuthorizationServerMetadata(origin, { registrationEnabled: isDcrEnabled(origin) }),
    { status: 200, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
