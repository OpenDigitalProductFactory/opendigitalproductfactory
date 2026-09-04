import type {
  SemanticSurfaceGraph,
  SurfaceFailure,
  SurfacePrincipalContext,
  SurfaceSession,
  SurfaceSummary,
} from "@dpf/types";

import { authorizedSurfaceRuntime, createServerSurfaceContext } from "./authorized-surface-registry";

type OpenResult =
  | { ok: true; session: SurfaceSession; summary: SurfaceSummary }
  | SurfaceFailure;
type SnapshotResult =
  | { ok: true; graph: SemanticSurfaceGraph }
  | { ok: true; delta: unknown }
  | SurfaceFailure;

export type AuthorizedSurfacePromptGroundingDeps = {
  createContext?: (
    context: SurfacePrincipalContext,
    authorizedToolNames: ReadonlySet<string>,
  ) => SurfacePrincipalContext;
  open: (input: {
    context: SurfacePrincipalContext;
    selector: {
      route?: string;
      workroomType?: string;
      resourceType?: string;
      taskIntent?: string;
    };
  }) => Promise<OpenResult>;
  snapshot: (input: {
    sessionId: string;
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">;
  }) => Promise<SnapshotResult>;
};

const defaultDeps: AuthorizedSurfacePromptGroundingDeps = {
  createContext: (context, authorizedToolNames) =>
    createServerSurfaceContext(context, { authorizedToolNames }),
  open: (input) => authorizedSurfaceRuntime.open({ context: input.context, selector: input.selector }),
  snapshot: (input) => authorizedSurfaceRuntime.snapshot(input),
};

const ACTION_REQUEST =
  /(?:^\s*(?:please\s+)?|\b(?:can|could|will|would)\s+you\s+)(?:configure|setup|set up|enter|fill|set|select|choose|click|press|save|submit|run|execute|perform|create|update|change|delete|remove|connect|test)\b/i;
const OPERATE_FOR_ME =
  /\b(?:configure|setup|set up|operate|do)\b.{0,80}\bfor me\b/i;
const GUIDANCE_REQUEST =
  /(?:\?|\b(?:how|what|why|where|which|explain|guide|walk me through|help me understand|should i|do i need)\b)/i;

/** True only for questions that can be answered from a prehydrated surface
 * without mutating it. Imperative/action language keeps the governed tools. */
export function isAuthorizedSurfaceGuidanceRequest(content: string): boolean {
  const text = content.trim();
  if (!text || !GUIDANCE_REQUEST.test(text)) return false;
  if (ACTION_REQUEST.test(text)) return false;
  if (OPERATE_FOR_ME.test(text)) return false;
  return true;
}

/**
 * Preserve exact, authorization-filtered UX facts at the response boundary.
 * Models may summarize prompt context and silently drop field/action labels;
 * those labels are part of the user-facing surface contract, not optional
 * prose. Missing highlights are appended verbatim after generation so every
 * renderer and coworker path gets the same deterministic coverage without a
 * page-specific response patch.
 */
export function enforceAuthorizedSurfaceGuidanceCoverage(
  content: string,
  guidanceHighlights: readonly string[],
): string {
  const exactHighlights = [...new Set(
    guidanceHighlights.map((highlight) => highlight.trim()).filter(Boolean),
  )];
  const missing = exactHighlights.filter((highlight) => !content.includes(highlight));
  if (missing.length === 0) return content;

  const base = content.trimEnd();
  const details = [
    "AUTHORIZED SURFACE DETAILS",
    ...missing.map((highlight) => `- ${highlight}`),
  ].join("\n");
  return base ? `${base}\n\n${details}` : details;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Render a compact, model-readable form of the semantic graph. The graph has
 * already applied the principal's surface/action authorization and omits
 * write-only, password, and secret values in the runtime projection.
 */
export function formatAuthorizedSurfacePrompt(
  graph: SemanticSurfaceGraph,
  sessionId: string,
  maxChars = 8_000,
): string {
  const lines = [
    "CURRENT AUTHORIZED SURFACE — TRUSTED UX STATE",
    "This is the current UX contract for the human/coworker principal pair. It includes rendered and authorized non-rendered state. Answer page/workroom questions from it even when tool use is unavailable. Do not guess beyond it.",
    `Surface: ${graph.summary.label} (${graph.surfaceId})`,
    `Purpose: ${graph.summary.purpose}`,
    `Status: ${graph.summary.status ?? "unspecified"}`,
    `Revision: ${graph.revision}`,
    `Surface session for governed actions: ${sessionId}`,
    "For configuration guidance, enumerate the exact applicable choices, fields, constraints, and submit/test action from this contract. Name write-only fields but never invent or reveal their values.",
    ...(graph.summary.highlights ?? []).map((highlight) => `Highlight: ${highlight}`),
    ...graph.nodes.map((node) => {
      const details = [
        node.value !== undefined ? `value=${json(node.value)}` : "",
        node.state ? `state=${json(node.state)}` : "",
        node.help ? `help=${json(node.help)}` : "",
        node.error ? `error=${json(node.error)}` : "",
      ].filter(Boolean).join("; ");
      return `Node ${node.nodeId} [${node.kind}] ${json(node.accessibleName)}${details ? ` — ${details}` : ""}`;
    }),
    ...graph.actions.map((action) =>
      `Action ${action.actionId}: ${json(action.label)}; class=${action.actionClass}; risk=${action.risk}; confirmation=${action.confirmation}`,
    ),
    "For a requested state change, use surface_act with the session id and current revision. Ordinary tool grants, policy checks, confirmation, and domain validation still apply.",
    "END CURRENT AUTHORIZED SURFACE",
  ];
  const block = lines.join("\n");
  if (block.length <= maxChars) return block;
  return `${block.slice(0, Math.max(0, maxChars - 72))}\n[Authorized surface context truncated to the bounded prompt budget.]`;
}

export async function groundPromptWithAuthorizedSurface(
  input: {
    systemPrompt: string;
    context: SurfacePrincipalContext;
    authorizedToolNames: ReadonlySet<string>;
    maxChars?: number;
  },
  deps: AuthorizedSurfacePromptGroundingDeps = defaultDeps,
): Promise<{
  systemPrompt: string;
  grounded: boolean;
  sessionId?: string;
  surfaceId?: string;
  guidanceHighlights?: string[];
  /**
   * The exact block appended, so the caller can declare it as an INSTRUCTION
   * span instead of letting it be screened as payload (BI-D9D661ED). This is a
   * projection of the platform's own UX, not customer data.
   */
  instructionBlock?: string;
}> {
  const selector = {
    route: input.context.route,
    workroomType: input.context.workContext?.workroomType,
    resourceType: input.context.workContext?.resourceType,
    taskIntent: input.context.workContext?.taskIntent,
  };
  if (!Object.values(selector).some(Boolean)) return { systemPrompt: input.systemPrompt, grounded: false };

  let openedSessionId: string | undefined;
  try {
    const context = deps.createContext
      ? deps.createContext(input.context, input.authorizedToolNames)
      : input.context;
    const opened = await deps.open({ context, selector });
    if (!opened.ok) return { systemPrompt: input.systemPrompt, grounded: false };
    openedSessionId = opened.session.sessionId;
    const snapshot = await deps.snapshot({
      sessionId: opened.session.sessionId,
      caller: {
        delegatingUserId: input.context.delegatingUserId,
        actingAgentId: input.context.actingAgentId,
      },
    });
    if (!snapshot.ok || !("graph" in snapshot)) {
      return { systemPrompt: input.systemPrompt, grounded: false, sessionId: openedSessionId };
    }
    const block = formatAuthorizedSurfacePrompt(snapshot.graph, opened.session.sessionId, input.maxChars);
    return {
      systemPrompt: `${input.systemPrompt}\n\n${block}`,
      grounded: true,
      sessionId: opened.session.sessionId,
      surfaceId: snapshot.graph.surfaceId,
      guidanceHighlights: [...(snapshot.graph.summary.highlights ?? [])],
      instructionBlock: block,
    };
  } catch (error) {
    console.warn(
      "[authorized-surface-grounding] failed open:",
      error instanceof Error ? error.message : error,
    );
    return {
      systemPrompt: input.systemPrompt,
      grounded: false,
      ...(openedSessionId ? { sessionId: openedSessionId } : {}),
    };
  }
}

/** Close the short-lived prehydration session after the model turn. Actions may
 * use it during the agentic loop; it must not accumulate after the turn ends. */
export async function closeAuthorizedSurfacePromptGrounding(
  sessionId: string | undefined,
  caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">,
): Promise<void> {
  if (!sessionId) return;
  await authorizedSurfaceRuntime.close(sessionId, caller).catch(() => false);
}
