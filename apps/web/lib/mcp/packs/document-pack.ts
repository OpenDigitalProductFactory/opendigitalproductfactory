// Managed-document tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "documentation" domain out of the mcp-tools.ts
// executeTool switch: the seven doc_* tools that read and write the managed
// document store (create/version, load, search, link, list versions, lifecycle
// state change, list references). Each handler lazy-imports its document-store
// dependency and reproduces the former switch case verbatim; the write-side
// handlers attribute the actor through the shared principal-linking façade.
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

// Local coercion helpers — copies of the mcp-tools.ts module helpers so the pack
// owns its inputs without depending on that module's internals.
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Resolve the principal id the document write should be attributed to: the
// calling agent's principal when present, else the acting user's principal.
async function resolveDocumentActorPrincipalId(userId: string, agentId?: string): Promise<string | null> {
  const { ensureAgentPrincipalIdentity, syncUserPrincipal } = await import("@/lib/identity/principal-linking");
  if (agentId) {
    const agentPrincipal = await ensureAgentPrincipalIdentity(agentId).catch(() => null);
    if (agentPrincipal?.id) return agentPrincipal.id;
  }
  const userPrincipal = await syncUserPrincipal(userId).catch(() => null);
  return userPrincipal?.id ?? null;
}

const definitions: ToolDefinition[] = [
  {
    name: "doc_save",
    description: "Create a managed document or append a new version. Use for coworker-authored briefs, policies, plans, and other durable non-code artifacts that need stable references, lifecycle, search, and version history.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Existing stable document id to version, such as DOC-1234ABCD. Omit to create a new document." },
        title: { type: "string", description: "Document title." },
        documentKind: { type: "string", description: "Brief type, e.g. brief, policy, plan, audit, decision, runbook." },
        contentFormat: { type: "string", description: "MIME-ish format, e.g. text/markdown, text/plain, text/html, application/pdf." },
        contentText: { type: "string", description: "Inline content for text documents under the inline storage limit." },
        contentBlobId: { type: "string", description: "DocumentBlob id for larger or binary content." },
        contentSha256: { type: "string", description: "SHA-256 of the content when known." },
        summary: { type: "string", description: "Version change summary or abstract." },
        tags: { type: "array", items: { type: "string" }, description: "Searchable tags." },
        references: {
          type: "array",
          description: "Stable references this version cites.",
          items: {
            type: "object",
            properties: {
              targetDocumentId: { type: "string" },
              targetExternalRef: { type: "string" },
              refType: { type: "string" },
              anchor: { type: "string" },
            },
            required: ["refType"],
          },
        },
        accessScope: { type: "string", enum: ["organization", "restricted"], description: "Default organization scope unless restricted." },
        sourceKind: { type: "string", enum: ["managed", "external"], description: "managed for stored content, external for stable stubs to repo/filesystem artifacts." },
        organizationId: { type: "string", description: "Organization id. Defaults to the install organization." },
      },
      required: ["title", "documentKind", "contentFormat"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "doc_load",
    description: "Load a managed document by stable document id, optionally pinned to a version.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Stable document id, such as DOC-1234ABCD." },
        version: { type: "number", description: "Optional version number. Defaults to current version." },
      },
      required: ["documentId"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "doc_search",
    description: "Search managed documents by metadata, tags, owner, lifecycle state, full text, and best-effort semantic similarity. Call once per search intent with a clear query and mode. Empty results mean refine the query or filters — do not re-call with identical arguments. On tool errors, fix inputs or grants once; do not blind-retry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Phrase or natural-language concept to search for." },
        mode: { type: "string", enum: ["metadata", "full-text", "semantic", "hybrid"], description: "Search mode. Hybrid combines Postgres filters and Qdrant semantic results." },
        state: { type: "string", enum: ["draft", "published", "archived"], description: "Lifecycle state filter." },
        documentKind: { type: "string", description: "Kind filter." },
        ownerPrincipalId: { type: "string", description: "Principal DB id for owner filter." },
        tags: { type: "array", items: { type: "string" }, description: "Tag filters." },
        organizationId: { type: "string", description: "Organization id filter." },
        limit: { type: "number", description: "Max results, default 25." },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true },
  },
  {
    name: "doc_link",
    description: "Add a managed document reference edge from one document to another document or external stable locator.",
    inputSchema: {
      type: "object",
      properties: {
        sourceDocumentId: { type: "string", description: "Source stable document id." },
        targetDocumentId: { type: "string", description: "Target stable document id, if the target is managed." },
        targetExternalRef: { type: "string", description: "External stable locator when the target is not managed." },
        refType: { type: "string", description: "Reference type, e.g. cites, supersedes, derived-from, blocks, evidence-for." },
        anchor: { type: "string", description: "Optional source anchor or section." },
      },
      required: ["sourceDocumentId", "refType"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "doc_version_list",
    description: "List version metadata for a managed document.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Stable document id." },
      },
      required: ["documentId"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "doc_state_change",
    description: "Transition a managed document lifecycle state and record a DocumentLifecycleEvent.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Stable document id." },
        toState: { type: "string", enum: ["draft", "published", "archived"], description: "Target lifecycle state." },
        reason: { type: "string", description: "Reason for the transition." },
        toolExecutionId: { type: "string", description: "Optional audit row id that produced this transition." },
      },
      required: ["documentId", "toState"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "doc_list_references",
    description: "List inbound and outbound managed document references for a document.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Stable document id." },
      },
      required: ["documentId"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

async function docSave(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const {
    saveManagedDocument,
  } = await import("@/lib/documents/document-store");
  const actorPrincipalId = await resolveDocumentActorPrincipalId(userId, context?.agentId);
  const references = Array.isArray(params["references"])
    ? params["references"].flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const ref = entry as Record<string, unknown>;
        const refType = optionalString(ref["refType"]);
        if (!refType) return [];
        return [{
          targetDocumentId: optionalString(ref["targetDocumentId"]),
          targetExternalRef: optionalString(ref["targetExternalRef"]),
          refType,
          anchor: optionalString(ref["anchor"]),
        }];
      })
    : [];
  const document = await saveManagedDocument({
    documentId: optionalString(params["documentId"]),
    organizationId: optionalString(params["organizationId"]),
    title: String(params["title"] ?? ""),
    documentKind: String(params["documentKind"] ?? ""),
    contentFormat: String(params["contentFormat"] ?? ""),
    contentText: optionalString(params["contentText"]),
    contentBlobId: optionalString(params["contentBlobId"]),
    contentSha256: optionalString(params["contentSha256"]),
    summary: optionalString(params["summary"]),
    tags: stringArray(params["tags"]),
    references,
    accessScope: optionalString(params["accessScope"]),
    sourceKind: optionalString(params["sourceKind"]),
    ownerPrincipalId: optionalString(params["ownerPrincipalId"]) ?? actorPrincipalId,
    createdByPrincipalId: actorPrincipalId,
    actorPrincipalId,
  });
  const version = (document as { version?: number }).version ?? document.currentVersion?.version ?? 1;
  return {
    success: true,
    entityId: document.documentId,
    message: `Saved document ${document.documentId} v${version}: /workspace/documents/${encodeURIComponent(document.documentId)}.`,
    data: {
      document: document as unknown as Record<string, unknown>,
      route: `/workspace/documents/${encodeURIComponent(document.documentId)}`,
    },
  };
}

async function docLoad(params: Record<string, unknown>): Promise<ToolResult> {
  const { loadManagedDocument } = await import("@/lib/documents/document-store");
  const document = await loadManagedDocument({
    documentId: String(params["documentId"] ?? ""),
    version: typeof params["version"] === "number" ? params["version"] : null,
  });
  if (!document) return { success: false, message: "Document not found.", error: "Document not found." };
  return {
    success: true,
    entityId: document.documentId,
    message: `Loaded document ${document.documentId}.`,
    data: { document: document as unknown as Record<string, unknown> },
  };
}

async function docSearch(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchManagedDocuments } = await import("@/lib/documents/document-store");
  const documents = await searchManagedDocuments({
    query: optionalString(params["query"]),
    mode: typeof params["mode"] === "string" ? params["mode"] as "metadata" | "full-text" | "semantic" | "hybrid" : "hybrid",
    currentState: optionalString(params["state"]),
    documentKind: optionalString(params["documentKind"]),
    ownerPrincipalId: optionalString(params["ownerPrincipalId"]),
    organizationId: optionalString(params["organizationId"]),
    tags: stringArray(params["tags"]),
    limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
  });
  const summary = documents.length === 0
    ? "No matching documents found."
    : documents.map((doc) => `${doc.documentId} ${doc.currentState} ${doc.title}`).join("\n");
  return {
    success: true,
    message: summary,
    data: { results: documents as unknown as Record<string, unknown>[] },
  };
}

async function docLink(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { linkManagedDocuments } = await import("@/lib/documents/document-store");
  const actorPrincipalId = await resolveDocumentActorPrincipalId(userId, context?.agentId);
  const result = await linkManagedDocuments({
    sourceDocumentId: String(params["sourceDocumentId"] ?? ""),
    targetDocumentId: optionalString(params["targetDocumentId"]),
    targetExternalRef: optionalString(params["targetExternalRef"]),
    refType: String(params["refType"] ?? ""),
    anchor: optionalString(params["anchor"]),
    actorPrincipalId,
  });
  return {
    success: true,
    entityId: result.referenceId,
    message: `Linked document reference ${result.referenceId}.`,
    data: result,
  };
}

async function docVersionList(params: Record<string, unknown>): Promise<ToolResult> {
  const { listManagedDocumentVersions } = await import("@/lib/documents/document-store");
  const versions = await listManagedDocumentVersions(String(params["documentId"] ?? ""));
  return {
    success: true,
    message: versions.length === 0 ? "No versions found." : `Found ${versions.length} document version${versions.length === 1 ? "" : "s"}.`,
    data: { versions: versions as unknown as Record<string, unknown>[] },
  };
}

async function docStateChange(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { changeManagedDocumentState } = await import("@/lib/documents/document-store");
  const actorPrincipalId = await resolveDocumentActorPrincipalId(userId, context?.agentId);
  const document = await changeManagedDocumentState({
    documentId: String(params["documentId"] ?? ""),
    toState: String(params["toState"] ?? ""),
    reason: optionalString(params["reason"]),
    toolExecutionId: optionalString(params["toolExecutionId"]),
    actorPrincipalId,
  });
  return {
    success: true,
    entityId: document.documentId,
    message: `Document ${document.documentId} moved to ${document.currentState}.`,
    data: { document: document as unknown as Record<string, unknown> },
  };
}

async function docListReferences(params: Record<string, unknown>): Promise<ToolResult> {
  const { listManagedDocumentReferences } = await import("@/lib/documents/document-store");
  const references = await listManagedDocumentReferences(String(params["documentId"] ?? ""));
  return {
    success: true,
    message: `Document references loaded for ${String(params["documentId"] ?? "")}.`,
    data: references,
  };
}

export const documentPack: ToolPack = {
  packId: "document",
  definitions,
  handlers: {
    doc_save: (params, userId, context) => docSave(params, userId, context),
    doc_load: (params) => docLoad(params),
    doc_search: (params) => docSearch(params),
    doc_link: (params, userId, context) => docLink(params, userId, context),
    doc_version_list: (params) => docVersionList(params),
    doc_state_change: (params, userId, context) => docStateChange(params, userId, context),
    doc_list_references: (params) => docListReferences(params),
  },
  grants: {
    doc_save: ["document_write", "registry_write"],
    doc_load: ["document_read", "registry_read"],
    doc_search: ["document_read", "registry_read"],
    doc_link: ["document_write", "registry_write"],
    doc_version_list: ["document_read", "registry_read"],
    doc_state_change: ["document_publish", "registry_write"],
    doc_list_references: ["document_read", "registry_read"],
  },
};
