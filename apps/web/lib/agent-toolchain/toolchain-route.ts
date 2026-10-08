import "server-only";

// BI-52934B3E — shared handling for the two public agent-toolchain routes:
// rate limit by client address, resolve this install's MCP endpoint, and
// refuse (never degrade to unsigned) when the pack or signing identity is
// unavailable.

import { apiErrorResponse } from "@/lib/api/error";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { clientAddressKey } from "@/lib/security/client-address";

import { getServedToolchain, type ServedToolchain } from "./served-toolchain";

export async function serveToolchain(
  request: Request,
  respond: (served: ServedToolchain) => Response,
): Promise<Response> {
  const limit = checkRateLimit(`agent-toolchain:${clientAddressKey(request.headers)}`, false);
  if (!limit.allowed) {
    const response = apiErrorResponse("RATE_LIMITED", "Too many agent-toolchain requests; retry shortly.", 429);
    if (limit.retryAfter) response.headers.set("Retry-After", String(limit.retryAfter));
    return response;
  }
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return apiErrorResponse(
      "NOT_CONFIGURED",
      "This install has no configured public URL, so it cannot name the endpoint its toolchain connects to.",
      404,
    );
  }
  try {
    return respond(await getServedToolchain(`${origin}/api/mcp/v1`));
  } catch (error) {
    console.warn("[agent-toolchain] cannot serve a signed toolchain:", error);
    return apiErrorResponse(
      "TOOLCHAIN_UNAVAILABLE",
      "The signed agent toolchain is not available on this install right now.",
      503,
    );
  }
}
