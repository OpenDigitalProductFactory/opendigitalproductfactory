// Pseudo-User Contract screen_* tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "view-command" domain out of the mcp-tools.ts
// executeTool switch: the eleven screen_* tools the coworker uses to drive the
// active portal screen (describe/get-state, select, navigate, open/close panel,
// focus/set/scroll form state, and the propose → dispatch envelope flow). Each
// tool returns a structured `data.event` payload the chat SSE stream relays to
// the client, which dispatches it as a window CustomEvent the active page
// handles via its registered ScreenManifest. The propose/dispatch pair persists
// a CoworkerActionEnvelope and closes the approve → execute loop.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; each
// handler reproduces the former switch case verbatim, resolving `prisma`,
// `getErrorMessage`, and the recursive `executeTool` dispatch through shared
// module imports so the pack owns its inputs without depending on
// mcp-tools.ts internals. Grants mirror agent-grants.ts TOOL_TO_GRANTS, which
// stays the gating source.

import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "screen_describe",
    description:
      "Pseudo-User Contract. Return the active ScreenManifest summary for the chat's current routeContext — the list of selections, navigations, panels, forms, and domain actions the coworker may invoke on this page. Read-only. Call once at the start of a turn to discover what's available before dispatching screen_* actions. Returns the manifest's serialisable metadata; live handlers stay on the client.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "screen_get_state",
    description:
      "Pseudo-User Contract. Return the current observable state of the active screen — selected entities (by selectionId), focused field id, open panel ids, current scroll anchor, current form values. Read-only. Source of truth is the page; this tool returns the snapshot the chat session plumbed in via screenState. Call screen_describe first for the manifest shape, then screen_get_state for the live values.",
    inputSchema: { type: "object", properties: {}, required: [] },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "screen_select_entity",
    description:
      "Pseudo-User Contract. Change the active screen's selection — e.g. switch which FeatureBuild is currently focused in Build Studio. The selectionId must match one declared by the active ScreenManifest; the entityId must come from that selection's listSource. Dispatches via the chat SSE channel; the page applies the change through its registered handler.",
    inputSchema: {
      type: "object",
      properties: {
        selectionId: { type: "string", description: "Manifest selection id (e.g. \"build\")." },
        entityId: { type: "string", description: "Id of the entity to select (from the manifest's listSource enumeration)." },
      },
      required: ["selectionId", "entityId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_navigate",
    description:
      "Pseudo-User Contract. Navigate to another route within the portal — e.g. /build → /storefront. Conditionally destructive: if the current page has unsaved form state the chat handler auto-wraps the call in an envelope (spec §6.4). Cross-coworker-ownership navigations will fire a HITL handoff gate.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string", description: "Target route path, e.g. \"/build/FB-5E20E793\"." },
        params: { type: "object", description: "Optional path/query parameters." },
      },
      required: ["route"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_open_panel",
    description:
      "Pseudo-User Contract. Open a panel registered in the active manifest — drawer, collapsible section, modal. Idempotent: opening an already-open panel is a no-op.",
    inputSchema: {
      type: "object",
      properties: {
        panelId: { type: "string", description: "Manifest panel id." },
      },
      required: ["panelId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_close_panel",
    description:
      "Pseudo-User Contract. Close a panel registered in the active manifest. Idempotent.",
    inputSchema: {
      type: "object",
      properties: {
        panelId: { type: "string", description: "Manifest panel id." },
      },
      required: ["panelId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_focus_field",
    description:
      "Pseudo-User Contract. Focus a specific form field on the active screen — useful when guiding the user to fix a validation error or fill in a missing value. The field must belong to a form declared in the manifest. Idempotent; cosmetic if the field is already focused.",
    inputSchema: {
      type: "object",
      properties: {
        formId: { type: "string", description: "Manifest form id." },
        fieldId: { type: "string", description: "Field id within the form." },
      },
      required: ["formId", "fieldId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_set_input",
    description:
      "Pseudo-User Contract. Pre-fill a form field on the user's behalf. The user can still review and modify before submit; the visual cue contract highlights coworker-set fields with an amber affordance + \"Set by <Coworker>\" tooltip. Not destructive by itself (reversible until submit) — submit is the destructive action and goes through the envelope flow.",
    inputSchema: {
      type: "object",
      properties: {
        formId: { type: "string", description: "Manifest form id." },
        fieldId: { type: "string", description: "Field id within the form." },
        value: { description: "Value to set. Type depends on the field's declared type." },
      },
      required: ["formId", "fieldId", "value"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_scroll_to",
    description:
      "Pseudo-User Contract. Scroll the page to a named anchor — useful when surfacing a row, section, or message that's currently off-screen. Read-class side effect (page state, no domain mutation).",
    inputSchema: {
      type: "object",
      properties: {
        anchor: { type: "string", description: "Anchor id, route fragment, or manifest-declared landmark." },
      },
      required: ["anchor"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_propose_action",
    description:
      "Pseudo-User Contract — destructive-action envelope flow. Propose a domain action that needs explicit user approval before execution. Creates a CoworkerActionEnvelope in `proposed` status, emits the proposal to the chat UI, and returns the envelope id so the chat handler can correlate the user's approve/deny response. Subject to the per-turn N=3 destructive auto-approval cap (spec §6.4); irreversible actions require an explicit typed-phrase floor and ignore elevation.",
    inputSchema: {
      type: "object",
      properties: {
        manifestActionId: { type: "string", description: "actionId from the active manifest's domainActions list." },
        args: { type: "object", description: "Arguments to pass to the underlying MCP tool when the envelope is approved." },
        rationale: { type: "string", description: "One-line plain-English reason shown to the user in the approval card." },
      },
      required: ["manifestActionId", "rationale"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, irreversibleHint: false },
    screenSurface: "*",
  },
  {
    name: "screen_dispatch_action",
    description:
      "Pseudo-User Contract. Execute a previously-proposed envelope by id once it's been approved (spec §6.4). Resolves the underlying tool from the envelope's manifestActionId + the active manifest's domainActions, runs it with the merged args, and records the outcome on the envelope (`executed` | `failed`). Destructive in the same sense as the underlying tool — the destructiveHint reflects the proposal's intent.",
    inputSchema: {
      type: "object",
      properties: {
        envelopeId: { type: "string", description: "CoworkerActionEnvelope id returned by screen_propose_action." },
      },
      required: ["envelopeId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, irreversibleHint: false },
    screenSurface: "*",
  },
];

async function screenDescribe(
  _params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const routeContext = context?.routeContext;
  const { surfacePack } = await import("./surface-pack");
  const surface = routeContext
    ? await surfacePack.handlers.surface_open({ route: routeContext, mode: "browser" }, userId, context)
    : null;
  if (surface && !surface.success) {
    const { observeSurfaceCompatibilityFallback } = await import("@/lib/coworker/authorized-surface-observability");
    observeSurfaceCompatibilityFallback({ adapter: "screen", reason: surface.error ?? "surface_unavailable", route: routeContext });
  }
  return {
    success: true,
    message: routeContext
      ? `Active screen manifest discovery requested for ${routeContext}.`
      : "Active screen manifest discovery requested (no routeContext plumbed).",
    data: {
      event: {
        type: "screen:describe_requested",
        payload: { routeContext: routeContext ?? null },
      },
      ...(surface?.success ? { authorizedSurface: surface.data } : {}),
      ...(surface && !surface.success ? { compatibilityFallback: surface.error ?? "surface_unavailable" } : {}),
    },
  };
}

async function screenGetState(
  _params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const { surfacePack } = await import("./surface-pack");
  const opened = context?.routeContext
    ? await surfacePack.handlers.surface_open({ route: context.routeContext, mode: "browser" }, userId, context)
    : null;
  const sessionId = opened?.success
    ? ((opened.data?.session as { sessionId?: string } | undefined)?.sessionId ?? null)
    : null;
  const snapshot = sessionId
    ? await surfacePack.handlers.surface_snapshot({ sessionId }, userId, context)
    : null;
  if ((opened && !opened.success) || (snapshot && !snapshot.success)) {
    const { observeSurfaceCompatibilityFallback } = await import("@/lib/coworker/authorized-surface-observability");
    observeSurfaceCompatibilityFallback({
      adapter: "screen",
      reason: snapshot?.error ?? opened?.error ?? "surface_unavailable",
      route: context?.routeContext,
    });
  }
  return {
    success: true,
    message: "Screen state snapshot requested.",
    data: {
      event: {
        type: "screen:state_requested",
        payload: { routeContext: context?.routeContext ?? null },
      },
      ...(snapshot?.success ? { authorizedSurface: snapshot.data } : {}),
      ...((opened && !opened.success) || (snapshot && !snapshot.success)
        ? { compatibilityFallback: snapshot?.error ?? opened?.error ?? "surface_unavailable" }
        : {}),
    },
  };
}

async function screenSelectEntity(params: Record<string, unknown>): Promise<ToolResult> {
  const selectionId = typeof params["selectionId"] === "string" ? params["selectionId"].trim() : "";
  const entityId = typeof params["entityId"] === "string" ? params["entityId"].trim() : "";
  if (!selectionId || !entityId) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_select_entity requires non-empty selectionId and entityId.",
    };
  }
  return {
    success: true,
    message: `Selection ${selectionId} → ${entityId} dispatched.`,
    data: {
      event: {
        type: "screen:select_entity",
        payload: { selectionId, entityId },
      },
    },
  };
}

async function screenNavigate(params: Record<string, unknown>): Promise<ToolResult> {
  const route = typeof params["route"] === "string" ? params["route"].trim() : "";
  if (!route) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_navigate requires a non-empty route.",
    };
  }
  const navParams =
    params["params"] && typeof params["params"] === "object" && !Array.isArray(params["params"])
      ? (params["params"] as Record<string, unknown>)
      : undefined;
  return {
    success: true,
    message: `Navigation to ${route} dispatched.`,
    data: {
      event: {
        type: "screen:navigate",
        payload: navParams ? { route, params: navParams } : { route },
      },
    },
  };
}

async function screenPanel(
  params: Record<string, unknown>,
  toolName: "screen_open_panel" | "screen_close_panel",
): Promise<ToolResult> {
  const panelId = typeof params["panelId"] === "string" ? params["panelId"].trim() : "";
  if (!panelId) {
    return {
      success: false,
      error: "missing_args",
      message: `${toolName} requires a non-empty panelId.`,
    };
  }
  const opening = toolName === "screen_open_panel";
  return {
    success: true,
    message: `Panel ${panelId} ${opening ? "open" : "close"} dispatched.`,
    data: {
      event: {
        type: opening ? "screen:open_panel" : "screen:close_panel",
        payload: { panelId },
      },
    },
  };
}

async function screenFocusField(params: Record<string, unknown>): Promise<ToolResult> {
  const formId = typeof params["formId"] === "string" ? params["formId"].trim() : "";
  const fieldId = typeof params["fieldId"] === "string" ? params["fieldId"].trim() : "";
  if (!formId || !fieldId) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_focus_field requires non-empty formId and fieldId.",
    };
  }
  return {
    success: true,
    message: `Focus dispatched: ${formId}/${fieldId}.`,
    data: { event: { type: "screen:focus_field", payload: { formId, fieldId } } },
  };
}

async function screenSetInput(params: Record<string, unknown>): Promise<ToolResult> {
  const formId = typeof params["formId"] === "string" ? params["formId"].trim() : "";
  const fieldId = typeof params["fieldId"] === "string" ? params["fieldId"].trim() : "";
  if (!formId || !fieldId) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_set_input requires non-empty formId and fieldId.",
    };
  }
  if (!("value" in params)) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_set_input requires a value (any type).",
    };
  }
  return {
    success: true,
    message: `Field ${formId}/${fieldId} set dispatched (visual cue BI-5696B4D7 will land alongside this in the client).`,
    data: {
      event: {
        type: "screen:set_input",
        payload: { formId, fieldId, value: params["value"] },
      },
    },
  };
}

async function screenScrollTo(params: Record<string, unknown>): Promise<ToolResult> {
  const anchor = typeof params["anchor"] === "string" ? params["anchor"].trim() : "";
  if (!anchor) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_scroll_to requires a non-empty anchor.",
    };
  }
  return {
    success: true,
    message: `Scroll to ${anchor} dispatched.`,
    data: { event: { type: "screen:scroll_to", payload: { anchor } } },
  };
}

async function screenProposeAction(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string; threadId?: string },
): Promise<ToolResult> {
  const manifestActionId =
    typeof params["manifestActionId"] === "string" ? params["manifestActionId"].trim() : "";
  const rationale = typeof params["rationale"] === "string" ? params["rationale"].trim() : "";
  if (!manifestActionId || !rationale) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_propose_action requires manifestActionId and rationale.",
    };
  }
  const args =
    params["args"] && typeof params["args"] === "object" && !Array.isArray(params["args"])
      ? (params["args"] as Record<string, unknown>)
      : {};
  // BI-0F9C291C wiring (part 3): write a CoworkerActionEnvelope row at
  // proposal time. Status defaults to "proposed" via the schema;
  // approveEnvelope / denyEnvelope from envelope-actions.ts drive the
  // row toward terminal. coworkerAgentId + threadId are NOT NULL on
  // the schema and come from the chat handler's execution context.
  // chatMessageId stays null until BI-DF6079E9 part 2 plumbs the
  // proposing AgentMessage id through. Per-turn N=3 destructive cap
  // and irreversible typed-phrase hard floor remain follow-on chunks.
  const coworkerAgentId = context?.agentId;
  if (!coworkerAgentId) {
    return {
      success: false,
      error: "missing_context",
      message:
        "screen_propose_action requires the executing coworker's agentId in execution context. Invoke via the chat handler, not directly.",
    };
  }
  const threadId = context?.threadId;
  if (!threadId) {
    return {
      success: false,
      error: "missing_context",
      message: "screen_propose_action requires threadId in execution context.",
    };
  }

  let envelope;
  try {
    envelope = await prisma.coworkerActionEnvelope.create({
      data: {
        coworkerAgentId,
        delegatingUserId: userId,
        threadId,
        // chatMessageId left null until BI-DF6079E9 part 2 plumbs
        // the proposing AgentMessage id through the chat handler.
        manifestActionId,
        argsJson: args as import("@dpf/db").Prisma.InputJsonValue,
        rationale,
        // status defaults to "proposed" via schema.prisma column default.
      },
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    return {
      success: false,
      error: "envelope_create_failed",
      message: `Failed to create envelope: ${msg}`,
    };
  }

  return {
    success: true,
    entityId: envelope.id,
    message: `Proposal '${manifestActionId}' recorded as envelope ${envelope.id} (proposed).`,
    data: {
      event: {
        type: "screen:action_proposed",
        payload: {
          envelopeId: envelope.id,
          manifestActionId,
          rationale,
          args,
          coworkerAgentId,
          delegatingUserId: userId,
        },
      },
    },
  };
}

async function screenDispatchAction(
  params: Record<string, unknown>,
  _userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  // BI-0F9C291C part 4 — end-to-end envelope execution. Closes the
  // propose → approve → dispatch loop:
  //   1. Load the envelope row (#1366 schema, #1415 propose-writes).
  //   2. Verify it's in `approved` status (only approved envelopes
  //      can dispatch — proposed envelopes must go through the
  //      /api/agent/envelope/:id/approve route first).
  //   3. Resolve manifestActionId → underlying MCP tool via
  //      findManifestForRoute (the server-side mirror of the
  //      client window registry — ALL_MANIFESTS is empty until
  //      BI-6C9CC0EC registers Build Studio, so this path returns
  //      a clear `no_manifest` error in the meantime).
  //   4. Execute the underlying tool recursively under the
  //      envelope's delegatingUserId (the human the coworker is
  //      acting for — not whoever called dispatch, though they
  //      should normally match).
  //   5. Mark the envelope executed | failed via
  //      markEnvelopeExecuted / markEnvelopeFailed from
  //      envelope-actions.ts. Marking is best-effort; the side
  //      effect already ran, so a finalisation write failure
  //      doesn't roll back — it's logged in the response.
  //
  // Per-turn N=3 destructive cap and irreversible typed-phrase
  // hard floor still land as separate follow-on chunks of
  // BI-0F9C291C.

  const envelopeId =
    typeof params["envelopeId"] === "string" ? params["envelopeId"].trim() : "";
  if (!envelopeId) {
    return {
      success: false,
      error: "missing_args",
      message: "screen_dispatch_action requires an envelopeId.",
    };
  }

  const routeContext = context?.routeContext;
  if (!routeContext) {
    return {
      success: false,
      error: "missing_context",
      message:
        "screen_dispatch_action requires routeContext in execution context. Invoke via the chat handler, not directly.",
    };
  }

  let envelope;
  try {
    envelope = await prisma.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  } catch (err) {
    const msg = getErrorMessage(err);
    return {
      success: false,
      error: "envelope_load_failed",
      message: `Failed to load envelope ${envelopeId}: ${msg}`,
    };
  }
  if (!envelope) {
    return {
      success: false,
      error: "envelope_not_found",
      message: `Envelope ${envelopeId} not found.`,
    };
  }
  if (envelope.status !== "approved") {
    return {
      success: false,
      error: "envelope_not_approved",
      message: `Envelope ${envelopeId} is in status '${envelope.status}'; must be 'approved' before dispatch.`,
    };
  }

  // Resolve manifest + action server-side. Reuses the same
  // route-matching the client registry uses (matchesRoute is
  // exported from screen-manifest-registry).
  const { findManifestForRoute } = await import("@/lib/coworker/manifests/index");
  const manifest = findManifestForRoute(routeContext);
  if (!manifest) {
    return {
      success: false,
      error: "no_manifest",
      message: `No ScreenManifest is registered for routeContext '${routeContext}'. ALL_MANIFESTS may still be empty (first consumer lands in BI-6C9CC0EC).`,
    };
  }
  const domainAction = manifest.domainActions.find(
    (a) => a.actionId === envelope.manifestActionId,
  );
  if (!domainAction) {
    return {
      success: false,
      error: "action_not_in_manifest",
      message: `Manifest '${manifest.surfaceId}' has no domain action '${envelope.manifestActionId}'.`,
    };
  }

  // Recurse: execute the underlying tool under the envelope's
  // delegating user (not necessarily the caller — see the doc
  // block above). executeTool is dynamically imported so the pack
  // carries no static dependency on the mcp-tools.ts module graph.
  const underlyingToolName = domainAction.tool;
  const toolArgs =
    envelope.argsJson && typeof envelope.argsJson === "object" && !Array.isArray(envelope.argsJson)
      ? (envelope.argsJson as Record<string, unknown>)
      : {};

  const { markEnvelopeExecuted, markEnvelopeFailed } = await import("@/lib/coworker/envelope-actions");
  const { executeTool } = await import("@/lib/mcp-tools");

  let toolResult: ToolResult;
  try {
    toolResult = await executeTool(underlyingToolName, toolArgs, envelope.delegatingUserId, context);
  } catch (err) {
    const msg = getErrorMessage(err);
    // The underlying tool threw — mark the envelope failed, then
    // return a structured tool_execution_threw response.
    await markEnvelopeFailed(envelopeId).catch(() => undefined);
    return {
      success: false,
      error: "tool_execution_threw",
      message: `Underlying tool '${underlyingToolName}' threw: ${msg}`,
      data: {
        event: {
          type: "screen:action_dispatch_failed",
          payload: { envelopeId, tool: underlyingToolName, manifestActionId: envelope.manifestActionId, error: msg },
        },
      },
    };
  }

  // Finalise the envelope based on the tool's structured success
  // flag. markEnvelope* uses the state machine (#1390); a write
  // failure here doesn't change the fact the side effect already
  // ran — log it on the response so the chat handler can surface.
  const finalise = toolResult.success
    ? await markEnvelopeExecuted(envelopeId)
    : await markEnvelopeFailed(envelopeId);

  return {
    success: toolResult.success,
    entityId: envelopeId,
    message: toolResult.success
      ? `Envelope ${envelopeId} executed (${underlyingToolName}): ${toolResult.message}`
      : `Envelope ${envelopeId} dispatch reported failure (${underlyingToolName}): ${toolResult.message}`,
    data: {
      event: {
        type: "screen:action_dispatched",
        payload: {
          envelopeId,
          tool: underlyingToolName,
          manifestActionId: envelope.manifestActionId,
          ok: toolResult.success,
        },
      },
      toolResult,
      // Surface finalisation outcome when it itself was refused —
      // e.g. envelope already terminal due to a race with cancel.
      ...(finalise.ok ? {} : { finaliseRefused: finalise.reason }),
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  screen_describe: (params, userId, context) => screenDescribe(params, userId, context),
  screen_get_state: (params, userId, context) => screenGetState(params, userId, context),
  screen_select_entity: (params) => screenSelectEntity(params),
  screen_navigate: (params) => screenNavigate(params),
  screen_open_panel: (params) => screenPanel(params, "screen_open_panel"),
  screen_close_panel: (params) => screenPanel(params, "screen_close_panel"),
  screen_focus_field: (params) => screenFocusField(params),
  screen_set_input: (params) => screenSetInput(params),
  screen_scroll_to: (params) => screenScrollTo(params),
  screen_propose_action: (params, userId, context) => screenProposeAction(params, userId, context),
  screen_dispatch_action: (params, userId, context) => screenDispatchAction(params, userId, context),
};

export const screenPack: ToolPack = {
  packId: "screen",
  definitions,
  handlers,
  grants: {
    screen_describe: ["coworker_screen_read"],
    screen_get_state: ["coworker_screen_read"],
    screen_scroll_to: ["coworker_screen_read"],
    screen_select_entity: ["coworker_screen_drive"],
    screen_navigate: ["coworker_screen_drive"],
    screen_open_panel: ["coworker_screen_drive"],
    screen_close_panel: ["coworker_screen_drive"],
    screen_focus_field: ["coworker_screen_drive"],
    screen_propose_action: ["coworker_screen_drive"],
    screen_dispatch_action: ["coworker_screen_drive"],
    screen_set_input: ["coworker_screen_fill"],
  },
};
