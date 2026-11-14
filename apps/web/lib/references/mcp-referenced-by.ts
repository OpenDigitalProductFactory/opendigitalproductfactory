// BI-A63A9476: `referencedBy` on the MCP `get_backlog_item` response (spec §5,
// "Read surfaces"). Filtered by the same reader as every surface, and carrying
// only id, kind, title and scope: never a snippet, so text planted by a less
// privileged writer reaches an agent's context only if the agent opens the
// source itself (OWASP LLM01, indirect prompt injection).

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ReferenceCorpus, ReferenceEntityKind } from "@dpf/db/entity-reference-scope";

import { listInbound, type ReferenceReadDeps, type ReferenceReader } from "./read-references";

export type McpReferencedBy = { id: string; kind: ReferenceEntityKind; title: string; scope: ReferenceCorpus };

const MCP_REFERENCE_LIMIT = 50;

export async function referencedByForTool(
  itemId: string,
  reader: ReferenceReader,
  deps: ReferenceReadDeps,
): Promise<McpReferencedBy[]> {
  const page = await listInbound(itemId, reader, { snippets: false, limit: MCP_REFERENCE_LIMIT }, deps);
  return page.rows.map((row) => ({ id: row.key, kind: row.kind, title: row.title, scope: row.scope }));
}

/** The caller's references, or an empty list when they cannot be read; a read tool never fails on them. */
export async function loadReferencedByForTool(input: { itemId: string; userId?: string | null; agentId?: string | null }): Promise<McpReferencedBy[]> {
  if (!input.userId) return [];
  try {
    const { agentReferenceReader, personReferenceReader, referenceReadDeps } = await import("./reference-reader.server");
    const { currentUserContext } = await import("@/lib/govern/current-user-context");
    const user = await currentUserContext(input.userId);
    if (!user) return [];
    const reader = input.agentId
      ? await agentReferenceReader({ userId: input.userId, agentId: input.agentId, canReadBacklog: true })
      : await personReferenceReader({ id: input.userId, ...user });
    return await referencedByForTool(input.itemId, reader, referenceReadDeps(reader));
  } catch (err) {
    console.warn(`[references] referencedBy for ${input.itemId} unavailable: ${getErrorMessage(err)}`);
    return [];
  }
}
