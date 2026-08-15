import type { SurfacePrincipalContext } from "@dpf/types";

import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";

import { createServerSurfaceContext } from "./authorized-surface-registry";

/**
 * Server-owned projection context for authenticated native/mobile renderers.
 * The synthetic actor is not a coworker identity and is never used to bypass
 * human capability checks: nested domain effects execute as the authenticated
 * human through governedExecuteTool and receive ordinary audit/confirmation.
 */
export function createMobileSurfaceContext(input: {
  userId: string;
  userContext: UserContext;
  selector?: {
    taskIntent?: string;
    workroomType?: string;
    resourceType?: string;
  };
}): SurfacePrincipalContext {
  const authorizedToolNames = new Set(PLATFORM_TOOLS.filter((tool) =>
    !tool.requiredCapability || can(input.userContext, tool.requiredCapability as CapabilityKey),
  ).map((tool) => tool.name));

  return createServerSurfaceContext({
    delegatingUserId: input.userId,
    actingAgentId: `mobile-renderer:${input.userId}`,
    mode: "mobile",
    locale: "en-US",
    timezone: "UTC",
    workContext: input.selector,
  }, {
    authorizedToolNames,
    governedDispatch: async (toolName, params) => governedExecuteTool({
      toolName,
      rawParams: params,
      userId: input.userId,
      userContext: input.userContext,
      source: "rest",
    }),
  });
}
