// Step-up authorization: turning a runtime scope refusal into a flow.
//
// MCP `2025-11-25` (`authorization.mdx:495-540`) defines a 403 carrying
// `error="insufficient_scope"` and the scope set needed, which a client answers
// by silently re-authorizing. DPF already had exactly that information — the
// `insufficient_token_scope` tool result names `requiredScope` and the required
// grants — but shaped as a payload whose documented remedy was "stop and tell
// the operator to mint a wider token". Same data; one is a flow, one is a halt.
//
// Lives here rather than in the transport route because constructing an OAuth
// challenge is authorization-server work, not JSON-RPC transport work.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §5 Slice 4

import type { McpTokenScope } from "@/lib/auth/mcp-api-token";
import { buildInsufficientScopeChallenge } from "@/lib/auth/oauth-metadata";
import { publicScopesGrantingGrant, type PublicScope } from "@/lib/auth/oauth-scope-map";

/** Present only for an OAuth caller. Its ABSENCE is what keeps every other
 *  caller on the original `insufficient_token_scope` contract, byte for byte. */
export type StepUpContext = { granted: PublicScope[]; origin: string | null };

export type StepUpChallenge = { header: string; data: Record<string, unknown> };

/**
 * Build the challenge for a scope refusal, or null when the caller is not an
 * OAuth client and must keep the legacy contract.
 *
 * Scope inclusion follows the spec's RECOMMENDED strategy
 * (`authorization.mdx:520-524`): the scopes already granted PLUS the ones
 * needed, so re-authorizing never costs the client authority it already had.
 * The required public scopes are derived from the tool's internal grants
 * through the same map consent used, so the challenge can never name a scope
 * that would not actually unlock the call.
 */
export function buildStepUpChallenge(
  stepUp: StepUpContext | undefined,
  requiredGrants: readonly string[],
  toolName: string,
  requiredScope: McpTokenScope,
): StepUpChallenge | null {
  if (!stepUp) return null;
  const needed = Array.from(new Set(requiredGrants.flatMap((g) => publicScopesGrantingGrant(g))));
  // A grant with no public scope would leave the client nothing to ask for;
  // fall back to the legacy result rather than emit an unsatisfiable challenge.
  // `oauth-scope-map.test.ts` asserts this cannot happen for any live tool.
  if (needed.length === 0) return null;

  const detail = `${toolName} needs additional authorization.`;
  return {
    header: buildInsufficientScopeChallenge(stepUp.origin, {
      granted: stepUp.granted,
      required: needed,
      detail,
    }),
    data: {
      error: "insufficient_scope",
      toolName,
      requiredScope,
      requiredGrants,
      grantedScopes: stepUp.granted,
      requiredScopes: needed,
      action: "Re-authorize with the scopes named in the WWW-Authenticate header, then retry.",
    },
  };
}
