/**
 * Authorized Surface Contract (ASC) wire types.
 *
 * This package is intentionally renderer-neutral. Browser, native mobile,
 * workroom, scheduled, background, and external MCP consumers exchange the
 * same graph and action vocabulary; none of these types contains a DOM node,
 * React callback, route handler, or executable function.
 */

export type SurfaceMode =
  | "browser"
  | "headless"
  | "workroom"
  | "scheduled"
  | "background"
  | "external"
  | "mobile";

export type SurfaceEntryPoint =
  | { kind: "route"; pattern: string }
  | { kind: "mobile-view"; viewId: string }
  | { kind: "workroom"; workroomType: string }
  | { kind: "resource"; resourceType: string }
  | { kind: "task-intent"; intent: string };

export type SurfaceNodeKind =
  | "surface"
  | "workspace"
  | "section"
  | "text"
  | "metric"
  | "alert"
  | "status"
  | "table"
  | "record"
  | "chart"
  | "form"
  | "field"
  | "choice"
  | "action"
  | "navigation"
  | "panel"
  | "media"
  | "relationship";

export type SurfaceSensitivity =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "secret";

export type SurfaceTrust = "trusted-system" | "trusted-user" | "untrusted";
export type SurfaceValuePolicy = "none" | "read" | "write-only";
export type SurfaceRisk = "low" | "medium" | "high" | "critical";
export type SurfaceActionClass = "ui-local" | "domain";
export type SurfaceConfirmation = "none" | "policy" | "required";
export type SurfaceFieldType =
  | "text"
  | "number"
  | "email"
  | "tel"
  | "select"
  | "checkbox"
  | "textarea"
  | "date"
  | "url"
  | "password";

export type SurfaceJson =
  | null
  | boolean
  | number
  | string
  | SurfaceJson[]
  | { [key: string]: SurfaceJson };

export interface SurfaceNodeDefinition {
  nodeId: string;
  kind: SurfaceNodeKind;
  accessibleName: string;
  description?: string;
  parentId?: string;
  valuePath?: string;
  valuePolicy: SurfaceValuePolicy;
  sensitivity: SurfaceSensitivity;
  fieldType?: SurfaceFieldType;
  presentationOnly?: boolean;
  /** False when the semantic value exists only to bind domain/headless work
   * and has no one-to-one rendered control. Defaults to true. */
  rendered?: boolean;
  when?: {
    nodeId: string;
    equals?: SurfaceJson;
    oneOf?: SurfaceJson[];
  };
}

export interface SurfaceActionDefinition {
  actionId: string;
  label: string;
  description?: string;
  actionClass: SurfaceActionClass;
  /** Registered MCP/domain operation. Required for domain actions only. */
  tool?: string;
  /** Virtual/co-present state transition. Only valid for UI-local actions. */
  localEffect?: {
    kind: "set-value" | "select" | "open-panel" | "close-panel" | "navigate";
    targetNodeId?: string;
  };
  risk: SurfaceRisk;
  confirmation: SurfaceConfirmation;
  inputSchema?: Record<string, SurfaceJson>;
  /** Action argument -> node id. Values are read from authorized session state. */
  argMap?: Record<string, string>;
  idempotent?: boolean;
}

export interface SurfaceDefinition {
  contractVersion: "1.0";
  surfaceId: string;
  label: string;
  purpose: string;
  supportedModes: SurfaceMode[];
  entryPoints: SurfaceEntryPoint[];
  loaderId: string;
  nodes: SurfaceNodeDefinition[];
  actions: SurfaceActionDefinition[];
}

export interface SurfacePrincipalContext {
  organizationId?: string;
  delegatingUserId: string;
  actingAgentId: string;
  mode: SurfaceMode;
  locale: string;
  timezone: string;
  route?: string;
  workContext?: {
    workspaceId?: string;
    workroomId?: string;
    workroomType?: string;
    resourceIds?: string[];
    resourceType?: string;
    taskIntent?: string;
  };
}

export interface SurfaceProvenance {
  source: string;
  trust: SurfaceTrust;
  sensitivity: SurfaceSensitivity;
}

export interface SurfaceNode {
  nodeId: string;
  kind: SurfaceNodeKind;
  accessibleName: string;
  description?: string;
  parentId?: string;
  value?: SurfaceJson;
  state?: Record<string, SurfaceJson>;
  help?: string;
  error?: string;
  validation?: Record<string, SurfaceJson>;
  childIds?: string[];
  actionIds?: string[];
  provenance: SurfaceProvenance;
}

export interface AvailableSurfaceAction {
  actionId: string;
  label: string;
  description?: string;
  actionClass: SurfaceActionClass;
  risk: SurfaceRisk;
  confirmation: SurfaceConfirmation;
  inputSchema?: Record<string, SurfaceJson>;
}

export interface SurfaceSummary {
  label: string;
  purpose: string;
  status?: string;
  highlights?: string[];
  alertCount?: number;
}

export interface SemanticSurfaceGraph {
  contractVersion: "1.0";
  surfaceId: string;
  revision: string;
  generatedAt: string;
  summary: SurfaceSummary;
  nodes: SurfaceNode[];
  actions: AvailableSurfaceAction[];
  continuations: SurfaceCursor[];
  provenance: SurfaceProvenance;
}

export interface SemanticSurfaceDelta {
  contractVersion: "1.0";
  surfaceId: string;
  fromRevision: string;
  toRevision: string;
  sequence: number;
  generatedAt: string;
  changedNodes: SurfaceNode[];
  removedNodeIds: string[];
  actions: AvailableSurfaceAction[];
}

export interface SurfaceCursor {
  cursor: string;
  nodeId: string;
  remaining?: number;
}

export interface SurfaceSession {
  sessionId: string;
  surfaceId: string;
  organizationId?: string;
  delegatingUserId: string;
  actingAgentId: string;
  mode: SurfaceMode;
  authorityDigest: string;
  revision: string;
  expiresAt: string;
}

export interface SurfaceCatalogEntry {
  surfaceId: string;
  label: string;
  purpose: string;
  supportedModes: SurfaceMode[];
  entryPoints: SurfaceEntryPoint[];
  contractDigest: string;
}

export type SurfaceErrorCode =
  | "surface_not_found"
  | "surface_context_required"
  | "surface_not_authorized"
  | "surface_revision_stale"
  | "surface_action_unmapped"
  | "surface_action_not_authorized"
  | "surface_action_failed"
  | "surface_projection_incomplete"
  | "surface_adapter_unavailable"
  | "surface_session_expired";

export interface SurfaceFailure {
  ok: false;
  code: SurfaceErrorCode;
  message: string;
  refreshRevision?: string;
}

export interface SurfaceActionSuccess {
  ok: true;
  revision: string;
  message: string;
  result?: {
    success: boolean;
    message: string;
    error?: string;
    data?: Record<string, unknown>;
  };
}
