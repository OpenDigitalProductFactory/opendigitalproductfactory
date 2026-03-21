// apps/web/lib/api/auth-middleware.ts
//
// Request authentication for REST API route handlers.
// Supports two authentication methods:
//   1. Bearer JWT token (mobile / programmatic clients)
//   2. NextAuth session cookie (browser / SSR fallback)
//
// Usage in a route handler:
//   const { user, capabilities } = await authenticateRequest(request);
//   requireCapability(capabilities, "view_portfolio");

import { prisma } from "@dpf/db";
import type { DpfSession } from "../auth";
import { auth } from "../auth";
import { getGrantedCapabilities } from "../permissions";
import { verifyAccessToken } from "./jwt";
import { apiError } from "./error";

export type AuthResult = {
  user: DpfSession["user"];
  capabilities: string[];
};

/**
 * Authenticate an incoming API request.
 *
 * 1. If an `Authorization: Bearer <token>` header is present, verify the JWT
 *    and look up the user in the database.
 * 2. Otherwise, fall back to the NextAuth session (cookie-based).
 * 3. If neither is present, throw a 401 error response.
 */
export async function authenticateRequest(
  request: Request,
): Promise<AuthResult> {
  // --- Path 1: Bearer JWT ---
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    let payload;
    try {
      payload = await verifyAccessToken(token);
    } catch {
      throw apiError("INVALID_TOKEN", "Invalid or expired access token", 401);
    }

    // Look up user to get current state
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { groups: { include: { platformRole: true } } },
    });

    if (!user || !user.isActive) {
      throw apiError("USER_INACTIVE", "User account is inactive or not found", 401);
    }

    const sessionUser: DpfSession["user"] = {
      id: user.id,
      email: user.email,
      type: "admin",
      platformRole: user.groups[0]?.platformRole.roleId ?? null,
      isSuperuser: user.isSuperuser,
      accountId: null,
      accountName: null,
      contactId: null,
    };

    const capabilities = getGrantedCapabilities({
      platformRole: sessionUser.platformRole,
      isSuperuser: sessionUser.isSuperuser,
    });

    return { user: sessionUser, capabilities };
  }

  // --- Path 2: NextAuth session ---
  const session = await auth();

  if (!session?.user) {
    throw apiError("UNAUTHENTICATED", "Authentication required", 401);
  }

  const sessionUser = session.user as DpfSession["user"];
  const capabilities = getGrantedCapabilities({
    platformRole: sessionUser.platformRole,
    isSuperuser: sessionUser.isSuperuser,
  });

  return { user: sessionUser, capabilities };
}

/**
 * Verify that the authenticated user has a specific capability.
 * Throws a 403 error response if the capability is not present.
 */
export function requireCapability(
  capabilities: string[],
  required: string,
): void {
  if (!capabilities.includes(required)) {
    throw apiError(
      "FORBIDDEN",
      `Missing required capability: ${required}`,
      403,
    );
  }
}

/**
 * Like authenticateRequest but additionally verifies the caller is an employee
 * (type === "admin"). Use for API routes that must never be called by customers.
 */
export async function requireEmployeeAuth(request: Request): Promise<AuthResult> {
  const result = await authenticateRequest(request);
  if (result.user.type !== "admin") {
    throw apiError("FORBIDDEN", "This endpoint requires employee authentication", 403);
  }
  return result;
}

/**
 * Like authenticateRequest but additionally verifies the caller is a customer
 * (type === "customer"). Use for portal-only API routes.
 */
export async function requireCustomerAuth(request: Request): Promise<AuthResult> {
  const result = await authenticateRequest(request);
  if (result.user.type !== "customer") {
    throw apiError("FORBIDDEN", "This endpoint requires customer authentication", 403);
  }
  return result;
}
