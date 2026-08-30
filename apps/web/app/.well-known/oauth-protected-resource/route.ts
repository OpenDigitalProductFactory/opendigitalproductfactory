// @exposure public — RFC 9728 metadata. Public by definition — a client must read it BEFORE it can authenticate.
// GET /.well-known/oauth-protected-resource
//
// RFC 9728 Protected Resource Metadata, root form. Clients that cannot parse a
// `resource_metadata` parameter out of the 401 challenge fall back to
// constructing well-known URIs, and the spec requires them to try the
// path-suffixed form first and this one second (`authorization.mdx:96-101`).
// Both must therefore exist and must return the same document.
//
// Public by design: this document names the authorization server and the read
// scope floor. It carries no secret and no install-identifying data beyond the
// origin the caller already knows.


import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/error";
import { buildProtectedResourceMetadata, resolveResourceOrigin } from "@/lib/auth/oauth-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    // Unconfigured public URL on a non-loopback host: advertising a guessed
    // origin would send clients somewhere we cannot vouch for.
    return apiErrorResponse(
      "NOT_CONFIGURED",
      "This install has no configured public URL, so it cannot name its own MCP resource.",
      404,
    );
  }
  return NextResponse.json(buildProtectedResourceMetadata(origin), {
    status: 200,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
