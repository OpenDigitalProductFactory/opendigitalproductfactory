// Server wiring for the tools/list ⇄ tools/call authority parity
// (BI-HDLEMP-04). The pure decision + injected-resolver contract lives in
// ./listing-authority; this module binds the real DB / grant / clearance
// loaders the MCP route needs, keeping the route transport module lean and the
// pure module free of server-only dependencies.

import "server-only";

import type { McpAuthSource } from "@/lib/mcp/tool-tier";

import { prisma } from "@dpf/db";

import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { getGrantedCapabilities, type UserContext } from "@/lib/permissions";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

import {
  isAgentToolListable,
  resolveListingAuthority,
  type ListingAuthority,
} from "./listing-authority";

/** The auth facts the listing filter needs — satisfied by the route's ResolvedAuth. */
type ListingToken = {
  userId: string;
  agentId: string | null;
  source: McpAuthSource;
};

// The acting agent's stored data sensitivity, or null when it cannot be
// resolved to an active, non-archived identity — mirrors the where-clause the
// call-path authority resolver uses (resolve-coworker-tool-authority), whose
// throw on an unresolved agent denies every action.
async function resolveAgentSensitivityForListing(agentId: string): Promise<string | null> {
  const agent = await prisma.agent
    .findFirst({
      where: {
        OR: [{ id: agentId }, { agentId }, { slugId: agentId }],
        status: "active",
        archived: false,
      },
      select: { sensitivity: true },
    })
    .catch(() => null);
  return agent?.sensitivity ?? null;
}

// The acting human's Principal.sensitivityClearance, loaded through the same
// effective-auth loader the call-path authority gate uses so the list and the
// call read one source of truth for clearance. Clearance is the DISTINCT axis
// from role: role rides on userContext.platformRole (the token-scope filter),
// clearance rides on the Principal here.
async function resolveHumanClearanceForListing(
  token: ListingToken,
  userContext: UserContext,
): Promise<readonly string[]> {
  const ctx = await loadEffectiveAuthContext({
    user: {
      id: token.userId,
      email: "",
      type: "admin",
      platformRole: userContext.platformRole,
      isSuperuser: userContext.isSuperuser,
      accountId: null,
      accountName: null,
      contactId: null,
    },
    grantedCapabilities: getGrantedCapabilities(userContext),
    authentication: {
      // An OAuth access token IS a bearer credential presented in the
      // Authorization header, exactly like a PAT — only the issuance path
      // differs. Mapping it to "bearer" is what keeps tools/list identical
      // across issuance paths; treating it as anything else would fork the
      // clearance axis and break the parity the design requires (§8).
      source: token.source === "session-jwt" ? "session" : "bearer",
      methods: [],
    },
    actingAgentId: token.agentId,
  });
  return ctx.sensitivityClearance;
}

/**
 * Resolve the static coworker-authority facts (agent grants + clearance) a
 * faithful tools/list must apply for an agent-bound token, so the list never
 * advertises a tool the call layer would reject. A non-agent-bound token does
 * zero extra work (the token-scope filter is already the whole authority).
 */
export async function resolveListingAuthorityForToken(
  token: ListingToken,
  userContext: UserContext,
): Promise<ListingAuthority> {
  return resolveListingAuthority(
    { agentId: token.agentId },
    {
      resolveAgentGrants: (agentId) => getAgentToolGrantsAsync(agentId),
      resolveAgentSensitivity: (agentId) => resolveAgentSensitivityForListing(agentId),
      resolveHumanClearance: () => resolveHumanClearanceForListing(token, userContext),
    },
  );
}

/**
 * Drop tools the resolved listing authority would reject at call, binding the
 * real grant predicate the call path uses. Order-preserving; the caller narrows
 * the result further (tier, loaded-session append) afterwards.
 */
export function filterListableTools<T extends { name: string }>(
  tools: readonly T[],
  authority: ListingAuthority,
): T[] {
  return tools.filter((t) => isAgentToolListable(t.name, authority, isToolAllowedByGrants));
}
