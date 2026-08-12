import { createHash } from "node:crypto";

import type {
  SurfaceDefinition,
  SurfaceEntryPoint,
  SurfaceMode,
} from "@dpf/types";

import type { ScreenManifest } from "./screen-manifest-types";

import { matchesRoute } from "./screen-manifest-registry";

const NODE_KINDS = new Set([
  "surface", "workspace", "section", "text", "metric", "alert", "status",
  "table", "record", "chart", "form", "field", "choice", "action",
  "navigation", "panel", "media", "relationship",
]);

export interface SurfaceContractViolation {
  code: string;
  surfaceId: string;
  message: string;
}

export interface SurfaceCompilerReferences {
  toolNames: ReadonlySet<string>;
  loaderIds: ReadonlySet<string>;
}

export interface SurfaceResolveContext {
  route?: string;
  mobileViewId?: string;
  workroomType?: string;
  resourceType?: string;
  taskIntent?: string;
}

export interface CompiledSurfaceCatalog {
  digest: string;
  definitions: readonly SurfaceDefinition[];
  resolve(context: SurfaceResolveContext): SurfaceDefinition | undefined;
  get(surfaceId: string): SurfaceDefinition | undefined;
}

function violation(
  code: string,
  definition: SurfaceDefinition,
  message: string,
): SurfaceContractViolation {
  return { code, surfaceId: definition.surfaceId, message };
}

export function lintSurfaceDefinitions(
  definitions: readonly SurfaceDefinition[],
  references: SurfaceCompilerReferences,
): SurfaceContractViolation[] {
  const violations: SurfaceContractViolation[] = [];
  const surfaceIds = new Set<string>();

  for (const definition of definitions) {
    if (surfaceIds.has(definition.surfaceId)) {
      violations.push(violation("ASC-001", definition, `Duplicate surfaceId '${definition.surfaceId}'.`));
    }
    surfaceIds.add(definition.surfaceId);

    if (definition.surfaceId.startsWith("/") || definition.surfaceId.includes(":")) {
      violations.push(violation("ASC-002", definition, "surfaceId must be stable product identity, not a route."));
    }
    if (definition.contractVersion !== "1.0") {
      violations.push(violation("ASC-003", definition, `Unsupported contractVersion '${definition.contractVersion}'.`));
    }
    if (!references.loaderIds.has(definition.loaderId)) {
      violations.push(violation("ASC-007", definition, `Unknown loader '${definition.loaderId}'.`));
    }

    const nodeIds = new Set<string>();
    for (const node of definition.nodes) {
      if (nodeIds.has(node.nodeId)) {
        violations.push(violation("ASC-004", definition, `Duplicate nodeId '${node.nodeId}'.`));
      }
      nodeIds.add(node.nodeId);
      if (!NODE_KINDS.has(node.kind)) {
        violations.push(violation("ASC-005", definition, `Unknown node kind '${node.kind}'.`));
      }
      if (!node.accessibleName.trim()) {
        violations.push(violation("ASC-006", definition, `Node '${node.nodeId}' needs an accessible name.`));
      }
      if ((node.sensitivity === "secret" || node.fieldType === "password") && node.valuePolicy === "read") {
        violations.push(violation("ASC-009", definition, `Secret/password node '${node.nodeId}' must be write-only.`));
      }
      if (node.when && !definition.nodes.some((candidate) => candidate.nodeId === node.when?.nodeId)) {
        violations.push(violation("ASC-013", definition, `Conditional node '${node.nodeId}' references unknown node '${node.when.nodeId}'.`));
      }
      if (node.when && ((node.when.equals === undefined) === (node.when.oneOf === undefined))) {
        violations.push(violation("ASC-014", definition, `Conditional node '${node.nodeId}' must declare exactly one of equals or oneOf.`));
      }
    }

    const actionIds = new Set<string>();
    for (const action of definition.actions) {
      if (actionIds.has(action.actionId)) {
        violations.push(violation("ASC-010", definition, `Duplicate actionId '${action.actionId}'.`));
      }
      actionIds.add(action.actionId);
      if (action.actionClass === "domain" && (!action.tool || !references.toolNames.has(action.tool))) {
        violations.push(violation("ASC-008", definition, `Domain action '${action.actionId}' has an unknown tool binding.`));
      }
      if (action.actionClass === "ui-local" && action.tool) {
        violations.push(violation("ASC-011", definition, `UI-local action '${action.actionId}' cannot bind a domain tool.`));
      }
      for (const nodeId of Object.values(action.argMap ?? {})) {
        if (!nodeIds.has(nodeId)) {
          violations.push(violation("ASC-012", definition, `Action '${action.actionId}' references unknown node '${nodeId}'.`));
        }
      }
    }
  }

  return violations;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function surfaceContractDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function entryMatches(entry: SurfaceEntryPoint, context: SurfaceResolveContext): boolean {
  switch (entry.kind) {
    case "route":
      if (!context.route) return false;
      if (entry.pattern.endsWith("/:rest*")) {
        const prefix = entry.pattern.slice(0, -"/:rest*".length).replace(/\/$/, "") || "/";
        return context.route === prefix || context.route.startsWith(`${prefix}/`);
      }
      return matchesRoute(context.route, entry.pattern);
    case "mobile-view":
      return entry.viewId === context.mobileViewId;
    case "workroom":
      return entry.workroomType === context.workroomType;
    case "resource":
      return entry.resourceType === context.resourceType;
    case "task-intent":
      return entry.intent.toLocaleLowerCase() === context.taskIntent?.trim().toLocaleLowerCase();
  }
}

export function compileSurfaceDefinitions(
  definitions: readonly SurfaceDefinition[],
  references: SurfaceCompilerReferences,
): CompiledSurfaceCatalog {
  const violations = lintSurfaceDefinitions(definitions, references);
  if (violations.length > 0) {
    throw new Error(violations.map((item) => `${item.code}: ${item.message}`).join("\n"));
  }
  const ordered = [...definitions].sort((a, b) => a.surfaceId.localeCompare(b.surfaceId));
  const byId = new Map(ordered.map((definition) => [definition.surfaceId, definition]));
  return {
    digest: surfaceContractDigest(ordered),
    definitions: ordered,
    resolve: (context) => ordered.find((definition) => definition.entryPoints.some((entry) => entryMatches(entry, context))),
    get: (surfaceId) => byId.get(surfaceId),
  };
}

/**
 * Transitional adapter only. It strips every executable legacy callback and
 * converts the serializable manifest shape into ASC metadata so ScreenManifest
 * cannot remain a second action-authority store.
 */
export function adaptScreenManifestToSurface(input: {
  manifest: ScreenManifest;
  loaderId: string;
  supportedModes: SurfaceMode[];
}): SurfaceDefinition {
  const { manifest } = input;
  const nodes: SurfaceDefinition["nodes"] = [
    { nodeId: "surface", kind: "surface", accessibleName: manifest.label, valuePolicy: "none", sensitivity: "internal" },
  ];
  const actions: SurfaceDefinition["actions"] = [];

  for (const form of manifest.forms) {
    const formNodeId = `form.${form.formId}`;
    nodes.push({ nodeId: formNodeId, parentId: "surface", kind: "form", accessibleName: form.label, valuePolicy: "none", sensitivity: "internal" });
    for (const field of form.fields) {
      nodes.push({
        nodeId: `${formNodeId}.${field.fieldId}`,
        parentId: formNodeId,
        kind: "field",
        accessibleName: field.label,
        fieldType: field.type,
        valuePolicy: field.type === "password" ? "write-only" : "read",
        sensitivity: field.type === "password" ? "secret" : "internal",
      });
    }
    actions.push({
      actionId: `${formNodeId}.submit`,
      label: `Submit ${form.label}`,
      actionClass: "domain",
      tool: form.submit.tool,
      argMap: Object.fromEntries(Object.entries(form.submit.argMap).map(([arg, fieldId]) => [arg, `${formNodeId}.${fieldId}`])),
      risk: form.destructive ? "high" : "medium",
      confirmation: form.destructive ? "required" : "policy",
    });
  }
  for (const legacy of manifest.domainActions) {
    actions.push({
      actionId: legacy.actionId,
      label: legacy.label,
      actionClass: "domain",
      tool: legacy.tool,
      risk: manifest.destructiveActions.includes(legacy.actionId) ? "high" : "medium",
      confirmation: manifest.destructiveActions.includes(legacy.actionId) ? "required" : "policy",
    });
  }

  return {
    contractVersion: "1.0",
    surfaceId: manifest.surfaceId,
    label: manifest.label,
    purpose: `Compatibility projection for ${manifest.label}.`,
    supportedModes: input.supportedModes,
    entryPoints: [{ kind: "route", pattern: manifest.routePattern }],
    loaderId: input.loaderId,
    nodes,
    actions,
  };
}

export function adaptPageContextProviderToSurface(input: {
  route: string;
  match: "exact" | "prefix";
  label: string;
  loaderId: string;
  supportedModes: SurfaceMode[];
}): SurfaceDefinition {
  return {
    contractVersion: "1.0",
    surfaceId: `legacy.page-context.${surfaceContractDigest(input.route).slice(0, 12)}`,
    label: input.label,
    purpose: `Compatibility projection for the legacy ${input.label} page context.`,
    supportedModes: input.supportedModes,
    entryPoints: [{ kind: "route", pattern: input.match === "prefix" ? `${input.route.replace(/\/$/, "")}/:rest*` : input.route }],
    loaderId: input.loaderId,
    nodes: [{
      nodeId: "legacy.page-context",
      kind: "text",
      accessibleName: `${input.label} page context`,
      valuePolicy: "read",
      sensitivity: "internal",
      presentationOnly: true,
    }],
    actions: [],
  };
}
