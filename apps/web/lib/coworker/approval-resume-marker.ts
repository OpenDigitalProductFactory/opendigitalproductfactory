// The `_approvalResume` marker (BI-C8EC05C9, spec D3).
//
// When a platform caller asks the platform to complete a person's approval
// (`approvalCompletion: "platform"`), the governed audit writes this marker on
// the call's park row. The approved-request runner replays the call from it:
//   - the original SOURCE, never the row's executionMode, which Ask again
//     rewrites to "proposal" (envelope-reraise.ts);
//   - the server-set baselines and the propose boundary;
//   - the room and the build the call ran under;
//   - the external-access INPUTS (the room and the standing-grant holder), so
//     the runner re-resolves access instead of trusting a stale boolean.
//
// It is server-written only, never a tool argument: its key is one of
// GOVERNED_AUDIT_PARAMETER_KEYS, which the readers strip. Pure and type-only
// imports, so the audit writer, the runner and the readers share one shape.
import type { SurfaceMode } from "@dpf/types";

import type { GovernedExecuteContext, GovernedExecuteSource } from "@/lib/mcp-governed-execute-types";

export const APPROVAL_RESUME_MARKER_KEY = "_approvalResume";

const SOURCES: readonly GovernedExecuteSource[] = ["rest", "jsonrpc", "external-jsonrpc", "internal-mcp-session", "agentic-loop"];
const SURFACE_MODES: readonly SurfaceMode[] = ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"];

export type ApprovalResumeMarker = {
  v: 1;
  source: GovernedExecuteSource;
  coworkerReadBaseline: boolean;
  coworkerAuthorizedSurfaceBaseline: boolean;
  authorizedSurfaceMode: SurfaceMode | null;
  proposeBoundary: boolean;
  workroomId: string | null;
  featureBuildId: string | null;
  /** Null when the call carried no external-access decision at all. */
  externalAccess: { workroomId: string | null; standingGrantAgentId: string | null } | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function buildApprovalResumeMarker(
  source: GovernedExecuteSource,
  context: GovernedExecuteContext | undefined,
): ApprovalResumeMarker {
  const workroomId = text(context?.authorizedSurfaceContext?.workroomId) ?? text(context?.roomAuthority?.workroomId);
  const mode = context?.authorizedSurfaceContext?.mode;
  return {
    v: 1,
    source,
    coworkerReadBaseline: context?.coworkerReadBaseline === true,
    coworkerAuthorizedSurfaceBaseline: context?.coworkerAuthorizedSurfaceBaseline === true,
    authorizedSurfaceMode: (SURFACE_MODES as readonly string[]).includes(mode ?? "") ? mode as SurfaceMode : null,
    proposeBoundary: context?.proposeBoundary === true,
    workroomId,
    featureBuildId: text(context?.featureBuildId),
    externalAccess: context?.externalAccessEnabled === undefined
      ? null
      : { workroomId, standingGrantAgentId: text(context?.agentId) },
  };
}

/** The marker on a stored park row's parameters, or null when absent or malformed. */
export function readApprovalResumeMarker(parameters: unknown): ApprovalResumeMarker | null {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const raw = (parameters as Record<string, unknown>)[APPROVAL_RESUME_MARKER_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const marker = raw as Record<string, unknown>;
  if (marker.v !== 1 || !SOURCES.includes(marker.source as GovernedExecuteSource)) return null;
  const access = marker.externalAccess && typeof marker.externalAccess === "object"
    ? marker.externalAccess as Record<string, unknown>
    : null;
  return {
    v: 1,
    source: marker.source as GovernedExecuteSource,
    coworkerReadBaseline: marker.coworkerReadBaseline === true,
    coworkerAuthorizedSurfaceBaseline: marker.coworkerAuthorizedSurfaceBaseline === true,
    authorizedSurfaceMode: (SURFACE_MODES as readonly string[]).includes(marker.authorizedSurfaceMode as string)
      ? marker.authorizedSurfaceMode as SurfaceMode
      : null,
    proposeBoundary: marker.proposeBoundary === true,
    workroomId: text(marker.workroomId),
    featureBuildId: text(marker.featureBuildId),
    externalAccess: access ? { workroomId: text(access.workroomId), standingGrantAgentId: text(access.standingGrantAgentId) } : null,
  };
}
