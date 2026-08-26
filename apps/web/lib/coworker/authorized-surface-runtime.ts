import type {
  AvailableSurfaceAction,
  SemanticSurfaceGraph,
  SurfaceActionDefinition,
  SurfaceCatalogEntry,
  SurfaceDefinition,
  SurfaceFailure,
  SurfaceJson,
  SurfaceNode,
  SurfacePrincipalContext,
  SemanticSurfaceDelta,
  SurfaceCursor,
  SurfaceSession,
  SurfaceSummary,
} from "@dpf/types";

import type {
  CompiledSurfaceCatalog,
  SurfaceResolveContext,
} from "./authorized-surface-compiler";
import { surfaceContractDigest } from "./authorized-surface-compiler";

export interface SurfaceLoaderResult {
  revisionSeed: string;
  summary: SurfaceSummary;
  values: Record<string, SurfaceJson | undefined>;
  states?: Record<string, Record<string, SurfaceJson>>;
  help?: Record<string, string>;
  errors?: Record<string, string>;
  accessibleNames?: Record<string, string>;
}

export type SurfaceLoader = (
  context: SurfacePrincipalContext,
) => Promise<SurfaceLoaderResult>;

export interface SurfaceDomainActionResult {
  success: boolean;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
}

type RuntimeDependencies = {
  catalog: CompiledSurfaceCatalog;
  loaders: ReadonlyMap<string, SurfaceLoader>;
  authorizeSurface: (
    context: SurfacePrincipalContext,
    definition: SurfaceDefinition,
  ) => Promise<boolean>;
  authorizeAction: (
    context: SurfacePrincipalContext,
    action: SurfaceActionDefinition,
  ) => Promise<boolean>;
  authorityDigest: (context: SurfacePrincipalContext) => Promise<string>;
  executeDomainAction: (
    action: SurfaceActionDefinition,
    args: Record<string, unknown>,
    context: SurfacePrincipalContext,
    invocation: { surfaceId: string; sessionId: string; revision: string; actionId: string },
  ) => Promise<SurfaceDomainActionResult>;
  now?: () => Date;
  createSessionId?: () => string;
  sessionTtlMs?: number;
  observe?: (event: {
    operation: "list" | "open" | "snapshot" | "query" | "act" | "close";
    outcome: string;
    mode?: SurfacePrincipalContext["mode"];
    surfaceId?: string;
    durationMs?: number;
    nodeCount?: number;
  }) => void;
};

type RuntimeSession = {
  session: SurfaceSession;
  definition: SurfaceDefinition;
  context: SurfacePrincipalContext;
  view: SurfaceLoaderResult;
  virtualValues: Map<string, SurfaceJson>;
  sequence: number;
  idempotency: Map<string, SurfaceActSuccess | SurfaceFailure>;
  cursors: Map<string, { revision: string; nodeIds: string[]; nextOffset: number }>;
  history: Map<string, SemanticSurfaceGraph>;
  clientSequence: number;
};

type SurfaceOpenSuccess = {
  ok: true;
  session: SurfaceSession;
  summary: SurfaceSummary;
  actions: AvailableSurfaceAction[];
};

type SurfaceSnapshotSuccess = { ok: true; graph: SemanticSurfaceGraph };
type SurfaceDeltaSuccess = { ok: true; delta: SemanticSurfaceDelta };
type SurfaceQuerySuccess = {
  ok: true;
  revision: string;
  nodes: SurfaceNode[];
  actions: AvailableSurfaceAction[];
  continuations: SurfaceCursor[];
};
export type SurfaceActSuccess = {
  ok: true;
  revision: string;
  message: string;
  result?: SurfaceDomainActionResult;
};

function isSurfaceFailure(
  value: RuntimeSession | SurfaceFailure,
): value is SurfaceFailure {
  return "ok" in value && value.ok === false;
}

function failure(code: SurfaceFailure["code"], message: string, refreshRevision?: string): SurfaceFailure {
  return { ok: false, code, message, ...(refreshRevision ? { refreshRevision } : {}) };
}

function selectorContext(
  selector: SurfaceResolveContext & { surfaceId?: string },
): SurfaceResolveContext {
  return {
    route: selector.route,
    mobileViewId: selector.mobileViewId,
    workroomType: selector.workroomType,
    resourceType: selector.resourceType,
    taskIntent: selector.taskIntent,
  };
}

function setNestedArgument(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return;
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function contextSelector(context: SurfacePrincipalContext): SurfaceResolveContext {
  return {
    route: context.route,
    workroomType: context.workContext?.workroomType,
    resourceType: context.workContext?.resourceType,
    taskIntent: context.workContext?.taskIntent,
  };
}

function availableAction(action: SurfaceActionDefinition): AvailableSurfaceAction {
  return {
    actionId: action.actionId,
    label: action.label,
    description: action.description,
    actionClass: action.actionClass,
    risk: action.risk,
    confirmation: action.confirmation,
    inputSchema: action.inputSchema,
  };
}

export function createAuthorizedSurfaceRuntime(deps: RuntimeDependencies) {
  const sessions = new Map<string, RuntimeSession>();
  const now = deps.now ?? (() => new Date());
  const createSessionId = deps.createSessionId ?? (() => crypto.randomUUID());
  const ttl = deps.sessionTtlMs ?? 15 * 60 * 1000;

  async function currentActions(record: RuntimeSession): Promise<AvailableSurfaceAction[]> {
    const actions: AvailableSurfaceAction[] = [];
    for (const action of record.definition.actions) {
      if (await deps.authorizeAction(record.context, action)) actions.push(availableAction(action));
    }
    return actions;
  }

  function computeRevision(record: RuntimeSession, authorityDigest: string): string {
    return surfaceContractDigest({
      surfaceId: record.definition.surfaceId,
      view: record.view.revisionSeed,
      authorityDigest,
      virtualState: Object.fromEntries([...record.virtualValues.entries()].sort(([a], [b]) => a.localeCompare(b))),
      sequence: record.sequence,
    });
  }

  async function getSession(
    sessionId: string,
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">,
  ): Promise<RuntimeSession | SurfaceFailure> {
    const record = sessions.get(sessionId);
    if (!record) return failure("surface_not_found", `Surface session '${sessionId}' was not found.`);
    if (
      record.session.delegatingUserId !== caller.delegatingUserId
      || record.session.actingAgentId !== caller.actingAgentId
    ) {
      return failure("surface_not_authorized", "Surface session belongs to a different human/coworker principal pair.");
    }
    if (new Date(record.session.expiresAt).getTime() <= now().getTime()) {
      sessions.delete(sessionId);
      return failure("surface_session_expired", `Surface session '${sessionId}' expired.`);
    }
    if (!(await deps.authorizeSurface(record.context, record.definition))) {
      sessions.delete(sessionId);
      return failure("surface_not_authorized", "The surface is no longer authorized for this principal/context.");
    }
    const authorityDigest = await deps.authorityDigest(record.context);
    if (authorityDigest !== record.session.authorityDigest) {
      sessions.delete(sessionId);
      return failure("surface_not_authorized", "Surface authority changed; open a new principal-bound session.");
    }
    return record;
  }

  function nodes(record: RuntimeSession): SurfaceNode[] {
    const valueFor = (nodeId: string): SurfaceJson | undefined =>
      record.virtualValues.get(nodeId) ?? record.view.values[nodeId];
    return record.definition.nodes.filter((node) => {
      if (!node.when) return true;
      const controllingValue = valueFor(node.when.nodeId);
      return node.when.oneOf
        ? node.when.oneOf.some((candidate) => surfaceContractDigest(candidate) === surfaceContractDigest(controllingValue))
        : surfaceContractDigest(node.when.equals) === surfaceContractDigest(controllingValue);
    }).map((node) => {
      const virtual = record.virtualValues.get(node.nodeId);
      const readable = node.valuePolicy === "read" && node.sensitivity !== "secret" && node.fieldType !== "password";
      const value = readable ? (virtual ?? record.view.values[node.nodeId]) : undefined;
      return {
        nodeId: node.nodeId,
        kind: node.kind,
        accessibleName: record.view.accessibleNames?.[node.nodeId] ?? node.accessibleName,
        description: node.description,
        parentId: node.parentId,
        ...(value !== undefined ? { value } : {}),
        ...(record.view.states?.[node.nodeId] ? { state: record.view.states[node.nodeId] } : {}),
        ...(record.view.help?.[node.nodeId] ? { help: record.view.help[node.nodeId] } : {}),
        ...(record.view.errors?.[node.nodeId] ? { error: record.view.errors[node.nodeId] } : {}),
        provenance: {
          source: record.definition.loaderId,
          trust: "trusted-system",
          sensitivity: node.sensitivity,
        },
      };
    });
  }

  async function graph(record: RuntimeSession): Promise<SemanticSurfaceGraph> {
    return {
      contractVersion: "1.0",
      surfaceId: record.definition.surfaceId,
      revision: record.session.revision,
      generatedAt: now().toISOString(),
      summary: record.view.summary,
      nodes: nodes(record),
      actions: await currentActions(record),
      continuations: [],
      provenance: { source: record.definition.loaderId, trust: "trusted-system", sensitivity: "internal" },
    };
  }

  function rememberGraph(record: RuntimeSession, value: SemanticSurfaceGraph): void {
    record.history.set(value.revision, value);
    while (record.history.size > 8) record.history.delete(record.history.keys().next().value!);
  }

  async function refreshView(record: RuntimeSession): Promise<void> {
    const loader = deps.loaders.get(record.definition.loaderId);
    if (!loader) return;
    const latest = await loader(record.context);
    if (latest.revisionSeed === record.view.revisionSeed) return;
    record.view = latest;
    record.sequence += 1;
    record.session.revision = computeRevision(record, record.session.authorityDigest);
    record.cursors.clear();
  }

  async function list(context: SurfacePrincipalContext): Promise<SurfaceCatalogEntry[]> {
    const started = Date.now();
    const entries: SurfaceCatalogEntry[] = [];
    const selector = contextSelector(context);
    const hasSelector = Object.values(selector).some((value) => value !== undefined && value !== "");
    const selectedSurfaceId = hasSelector ? deps.catalog.resolve(selector)?.surfaceId : undefined;
    for (const definition of deps.catalog.definitions) {
      if (!definition.supportedModes.includes(context.mode)) continue;
      if (!(await deps.authorizeSurface(context, definition))) continue;
      if (hasSelector && selectedSurfaceId !== definition.surfaceId) continue;
      entries.push({
        surfaceId: definition.surfaceId,
        label: definition.label,
        purpose: definition.purpose,
        supportedModes: definition.supportedModes,
        entryPoints: definition.entryPoints,
        contractDigest: surfaceContractDigest(definition),
      });
    }
    deps.observe?.({ operation: "list", outcome: "success", mode: context.mode, durationMs: Date.now() - started });
    return entries;
  }

  async function open(input: {
    context: SurfacePrincipalContext;
    selector: SurfaceResolveContext & { surfaceId?: string };
  }): Promise<SurfaceOpenSuccess | SurfaceFailure> {
    const started = Date.now();
    const definition = input.selector.surfaceId
      ? deps.catalog.get(input.selector.surfaceId)
      : deps.catalog.resolve(selectorContext(input.selector));
    if (!definition) {
      deps.observe?.({ operation: "open", outcome: "surface_not_found", mode: input.context.mode, durationMs: Date.now() - started });
      return failure(
        "surface_not_found",
        // Self-describing on purpose (BI-E72BA4CD): a weak model previously read
        // "no surface matches" as "the node is empty" and told the operator a
        // populated portfolio node had no coverage. State plainly that this is a
        // TOOL/authorization gap, NOT evidence about the underlying data.
        "This surface could not be opened: no Authorized Surface is registered for this identity/context " +
          "(a tooling/authorization gap). This is NOT evidence that the node, portfolio, or estate is empty — " +
          "the underlying data was not read. Do not report it as empty or missing; report that the surface could not be loaded.",
      );
    }
    const boundSelector = contextSelector(input.context);
    const hasBoundSelector = Object.values(boundSelector).some((value) => value !== undefined && value !== "");
    if (hasBoundSelector && deps.catalog.resolve(boundSelector)?.surfaceId !== definition.surfaceId) {
      return failure("surface_not_authorized", "The requested surface is not relevant to this server-bound route/work context.");
    }
    if (!definition.supportedModes.includes(input.context.mode)) {
      return failure("surface_adapter_unavailable", `Surface '${definition.surfaceId}' does not support ${input.context.mode} mode.`);
    }
    if (!(await deps.authorizeSurface(input.context, definition))) {
      return failure("surface_not_authorized", "The surface is not authorized for this principal/context.");
    }
    const loader = deps.loaders.get(definition.loaderId);
    if (!loader) return failure("surface_projection_incomplete", `Loader '${definition.loaderId}' is unavailable.`);
    const view = await loader(input.context);
    const authorityDigest = await deps.authorityDigest(input.context);
    const sessionId = createSessionId();
    const record: RuntimeSession = {
      session: {
        sessionId,
        surfaceId: definition.surfaceId,
        organizationId: input.context.organizationId,
        delegatingUserId: input.context.delegatingUserId,
        actingAgentId: input.context.actingAgentId,
        mode: input.context.mode,
        authorityDigest,
        revision: "",
        expiresAt: new Date(now().getTime() + ttl).toISOString(),
      },
      definition,
      context: input.context,
      view,
      virtualValues: new Map(),
      sequence: 0,
      idempotency: new Map(),
      cursors: new Map(),
      history: new Map(),
      clientSequence: 0,
    };
    record.session.revision = computeRevision(record, authorityDigest);
    sessions.set(sessionId, record);
    const initialGraph = await graph(record);
    rememberGraph(record, initialGraph);
    const opened = { ok: true as const, session: { ...record.session }, summary: view.summary, actions: initialGraph.actions };
    deps.observe?.({ operation: "open", outcome: "success", mode: input.context.mode, surfaceId: definition.surfaceId, durationMs: Date.now() - started });
    return opened;
  }

  async function snapshot(input: {
    sessionId: string;
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">;
    sinceRevision?: string;
  }): Promise<SurfaceSnapshotSuccess | SurfaceDeltaSuccess | SurfaceFailure> {
    const started = Date.now();
    const record = await getSession(input.sessionId, input.caller);
    if (isSurfaceFailure(record)) {
      deps.observe?.({ operation: "snapshot", outcome: record.code, durationMs: Date.now() - started });
      return record;
    }
    await refreshView(record);
    const current = await graph(record);
    rememberGraph(record, current);
    if (input.sinceRevision && input.sinceRevision !== current.revision) {
      const previous = record.history.get(input.sinceRevision);
      if (!previous) return failure("surface_revision_stale", "Delta base revision is unavailable; refresh the full snapshot.", current.revision);
      const previousNodes = new Map(previous.nodes.map((node) => [node.nodeId, node]));
      const currentIds = new Set(current.nodes.map((node) => node.nodeId));
      const changedNodes = current.nodes.filter((node) => surfaceContractDigest(node) !== surfaceContractDigest(previousNodes.get(node.nodeId)));
      const delta: SemanticSurfaceDelta = {
        contractVersion: "1.0",
        surfaceId: current.surfaceId,
        fromRevision: input.sinceRevision,
        toRevision: current.revision,
        sequence: record.sequence,
        generatedAt: current.generatedAt,
        changedNodes,
        removedNodeIds: previous.nodes.filter((node) => !currentIds.has(node.nodeId)).map((node) => node.nodeId),
        actions: current.actions,
      };
      deps.observe?.({ operation: "snapshot", outcome: "delta", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started, nodeCount: changedNodes.length });
      return { ok: true, delta };
    }
    deps.observe?.({ operation: "snapshot", outcome: "success", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started, nodeCount: current.nodes.length });
    return { ok: true, graph: current };
  }

  async function query(input: {
    sessionId: string;
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">;
    text?: string;
    kind?: string;
    limit?: number;
    cursor?: string;
  }): Promise<SurfaceQuerySuccess | SurfaceFailure> {
    const started = Date.now();
    const record = await getSession(input.sessionId, input.caller);
    if (isSurfaceFailure(record)) {
      deps.observe?.({ operation: "query", outcome: record.code, durationMs: Date.now() - started });
      return record;
    }
    await refreshView(record);
    const search = input.text?.trim().toLocaleLowerCase();
    const allNodes = nodes(record);
    const matched = allNodes.filter((node) => {
      if (input.kind && node.kind !== input.kind) return false;
      if (!search) return true;
      return [node.accessibleName, node.description, node.help, typeof node.value === "string" ? node.value : ""]
        .some((value) => value?.toLocaleLowerCase().includes(search));
    });
    let offset = 0;
    let nodeIds = matched.map((node) => node.nodeId);
    if (input.cursor) {
      const state = record.cursors.get(input.cursor);
      if (!state || state.revision !== record.session.revision) {
        return failure("surface_revision_stale", "Query cursor is missing or stale; start the query again.", record.session.revision);
      }
      offset = state.nextOffset;
      nodeIds = state.nodeIds;
      record.cursors.delete(input.cursor);
    }
    const pageSize = Math.max(1, Math.min(input.limit ?? 25, 100));
    const pageIds = nodeIds.slice(offset, offset + pageSize);
    const page = pageIds.map((nodeId) => allNodes.find((node) => node.nodeId === nodeId)).filter((node): node is SurfaceNode => !!node);
    const nextOffset = offset + page.length;
    const continuations: SurfaceCursor[] = [];
    if (nextOffset < nodeIds.length) {
      const cursor = crypto.randomUUID();
      record.cursors.set(cursor, { revision: record.session.revision, nodeIds, nextOffset });
      continuations.push({ cursor, nodeId: page.at(-1)?.nodeId ?? "surface", remaining: nodeIds.length - nextOffset });
    }
    const result = { ok: true as const, revision: record.session.revision, nodes: page, actions: await currentActions(record), continuations };
    deps.observe?.({ operation: "query", outcome: "success", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started, nodeCount: page.length });
    return result;
  }

  async function syncClientState(input: {
    sessionId: string;
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">;
    expectedRevision: string;
    sequence: number;
    changes: Record<string, SurfaceJson>;
  }): Promise<SurfaceActSuccess | SurfaceFailure> {
    const record = await getSession(input.sessionId, input.caller);
    if (isSurfaceFailure(record)) return record;
    if (record.context.mode !== "browser" && record.context.mode !== "mobile") {
      return failure("surface_adapter_unavailable", "Co-present client state is only accepted from browser or mobile sessions.");
    }
    if (input.expectedRevision !== record.session.revision || input.sequence !== record.clientSequence + 1) {
      return failure("surface_revision_stale", "Client state sequence or revision is stale.", record.session.revision);
    }
    const writableTargets = new Set(record.definition.actions
      .filter((action) => action.actionClass === "ui-local" && action.localEffect?.kind === "set-value")
      .map((action) => action.localEffect?.targetNodeId)
      .filter((nodeId): nodeId is string => !!nodeId));
    for (const [nodeId, value] of Object.entries(input.changes)) {
      if (!writableTargets.has(nodeId)) return failure("surface_action_unmapped", `Node '${nodeId}' has no compiled client-state binding.`);
      record.virtualValues.set(nodeId, value);
    }
    record.clientSequence = input.sequence;
    record.sequence += 1;
    record.session.revision = computeRevision(record, record.session.authorityDigest);
    record.cursors.clear();
    const current = await graph(record);
    rememberGraph(record, current);
    return { ok: true, revision: record.session.revision, message: "Co-present client state synchronized." };
  }

  async function act(input: {
    sessionId: string;
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">;
    actionId: string;
    expectedRevision: string;
    args: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<SurfaceActSuccess | SurfaceFailure> {
    const started = Date.now();
    const record = await getSession(input.sessionId, input.caller);
    if (isSurfaceFailure(record)) {
      deps.observe?.({ operation: "act", outcome: record.code, durationMs: Date.now() - started });
      return record;
    }
    if (input.idempotencyKey) {
      const prior = record.idempotency.get(input.idempotencyKey);
      if (prior) return prior;
    }
    if (input.expectedRevision !== record.session.revision) {
      deps.observe?.({ operation: "act", outcome: "surface_revision_stale", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started });
      return failure("surface_revision_stale", "Surface revision is stale; refresh before acting.", record.session.revision);
    }
    const action = record.definition.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action) return failure("surface_action_unmapped", `Action '${input.actionId}' is not mapped on this surface.`);
    if (!(await deps.authorizeAction(record.context, action))) {
      return failure("surface_action_not_authorized", `Action '${input.actionId}' is not authorized.`);
    }

    if (action.actionClass === "ui-local") {
      const target = action.localEffect?.targetNodeId;
      if (!target || action.localEffect?.kind !== "set-value" || !("value" in input.args)) {
        return failure("surface_action_unmapped", `UI-local action '${input.actionId}' has no supported state binding.`);
      }
      record.virtualValues.set(target, input.args.value as SurfaceJson);
      record.sequence += 1;
      record.session.revision = computeRevision(record, record.session.authorityDigest);
      const result: SurfaceActSuccess = { ok: true, revision: record.session.revision, message: `${action.label} applied to virtual surface state.` };
      if (input.idempotencyKey) record.idempotency.set(input.idempotencyKey, result);
      deps.observe?.({ operation: "act", outcome: "success", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started });
      return result;
    }

    if (!action.tool) return failure("surface_action_unmapped", `Domain action '${action.actionId}' has no tool binding.`);
    const toolArgs: Record<string, unknown> = {};
    for (const [argName, nodeId] of Object.entries(action.argMap ?? {})) {
      const nodeDefinition = record.definition.nodes.find((node) => node.nodeId === nodeId);
      const value = record.virtualValues.get(nodeId)
        ?? (nodeDefinition?.valuePolicy === "read" ? record.view.values[nodeId] : undefined);
      if (value !== undefined) setNestedArgument(toolArgs, argName, value);
    }
    const allowedInputNames = new Set(Object.keys((action.inputSchema?.properties as Record<string, unknown> | undefined) ?? {}));
    for (const [key, value] of Object.entries(input.args)) {
      if (allowedInputNames.has(key)) toolArgs[key] = value;
    }
    const domainResult = await deps.executeDomainAction(action, toolArgs, record.context, {
      surfaceId: record.definition.surfaceId,
      sessionId: record.session.sessionId,
      revision: record.session.revision,
      actionId: action.actionId,
    });
    if (!domainResult.success) {
      const failed = failure("surface_action_failed", domainResult.message);
      if (input.idempotencyKey) record.idempotency.set(input.idempotencyKey, failed);
      return failed;
    }
    const loader = deps.loaders.get(record.definition.loaderId);
    if (!loader) return failure("surface_projection_incomplete", `Loader '${record.definition.loaderId}' is unavailable.`);
    record.view = await loader(record.context);
    record.sequence += 1;
    record.session.revision = computeRevision(record, record.session.authorityDigest);
    record.cursors.clear();
    rememberGraph(record, await graph(record));
    const result: SurfaceActSuccess = { ok: true, revision: record.session.revision, message: domainResult.message, result: domainResult };
    if (input.idempotencyKey) record.idempotency.set(input.idempotencyKey, result);
    deps.observe?.({ operation: "act", outcome: "success", mode: record.context.mode, surfaceId: record.definition.surfaceId, durationMs: Date.now() - started });
    return result;
  }

  async function close(
    sessionId: string,
    caller: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">,
  ): Promise<boolean> {
    const record = await getSession(sessionId, caller);
    if (isSurfaceFailure(record)) return false;
    const closed = sessions.delete(sessionId);
    deps.observe?.({ operation: "close", outcome: closed ? "success" : "surface_not_found", mode: record.context.mode, surfaceId: record.definition.surfaceId });
    return closed;
  }

  return { list, open, snapshot, query, syncClientState, act, close };
}
