// apps/web/lib/tak/backlog-create-claim-guard.ts
//
// BI-1BB7408D: structural-verification-is-not-functional for backlog creates.
// Models on /ops have claimed "Created: BI-XXXX" while returning a pre-existing
// id (or inventing one) without a successful create_backlog_item tool result.
// The chat layer must only allow create claims that match tool evidence from
// this turn.

export type ToolResultLike = {
  success?: boolean;
  entityId?: string | null;
  message?: string | null;
  data?: unknown;
  error?: string | null;
};

export type ExecutedToolLike = {
  name: string;
  result: ToolResultLike;
};

/** Semantic BI ids as returned by create_backlog_item (BI-*, BI-IMP-*, etc.). */
const BI_ID_PATTERN = /BI-[A-Z0-9][A-Z0-9-]{3,}/gi;

/**
 * Phrases that assert a backlog item was created this turn.
 * Intentionally requires "created" proximity so mere mentions of BI ids
 * (e.g. "see BI-FOO for context") are left alone.
 */
const CREATE_CLAIM_NEAR_BI =
  /(?:created|filed|opened|added)\s+(?:backlog\s+item\s+)?(?:as\s+)?(BI-[A-Z0-9][A-Z0-9-]{3,})/gi;

const CREATED_COLON_BI = /created:\s*(BI-[A-Z0-9][A-Z0-9-]{3,})/gi;

/**
 * Collect BI ids the model claims were created in free text.
 */
export function extractClaimedCreatedBacklogIds(content: string): string[] {
  if (!content) return [];
  const found = new Set<string>();
  for (const re of [CREATE_CLAIM_NEAR_BI, CREATED_COLON_BI]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const id = match[1]?.toUpperCase();
      if (id) found.add(id);
    }
  }
  // Also catch "Created backlog item BI-XXX" via the tool message phrasing
  // when "created" appears earlier in the same sentence.
  const sentences = content.split(/(?<=[.!\n])/);
  for (const sentence of sentences) {
    if (!/\bcreat(?:ed|ing)\b/i.test(sentence)) continue;
    BI_ID_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BI_ID_PATTERN.exec(sentence)) !== null) {
      found.add(match[0].toUpperCase());
    }
  }
  return [...found];
}

/**
 * BI ids successfully returned by create_backlog_item in this turn's tools.
 */
export function extractToolCreatedBacklogIds(executedTools: readonly ExecutedToolLike[]): string[] {
  const found = new Set<string>();
  for (const tool of executedTools) {
    if (tool.name !== "create_backlog_item") continue;
    if (!tool.result?.success) continue;
    const entityId =
      typeof tool.result.entityId === "string" && tool.result.entityId.trim()
        ? tool.result.entityId.trim()
        : null;
    if (entityId && /^BI-/i.test(entityId)) {
      found.add(entityId.toUpperCase());
      continue;
    }
    // Fallback: parse message "Created backlog item BI-XXXX"
    const message = typeof tool.result.message === "string" ? tool.result.message : "";
    BI_ID_PATTERN.lastIndex = 0;
    const fromMessage = message.match(BI_ID_PATTERN);
    if (fromMessage) {
      for (const id of fromMessage) found.add(id.toUpperCase());
    }
    // structured data.itemId
    const data = tool.result.data;
    if (data && typeof data === "object" && "itemId" in data) {
      const itemId = (data as { itemId?: unknown }).itemId;
      if (typeof itemId === "string" && /^BI-/i.test(itemId)) {
        found.add(itemId.toUpperCase());
      }
    }
  }
  return [...found];
}

const UNSUPPORTED_CREATE_NOTE =
  "Correction: no backlog item was created in this turn. " +
  "I did not get a confirmed create_backlog_item tool result for the id(s) above, " +
  "so I cannot treat them as newly filed. Ask me to file the item again and I will call the tool.";

/**
 * Rewrite or annotate a reply that claims backlog creates without tool proof.
 *
 * - If the model claims BI ids that are not in this turn's successful
 *   create_backlog_item results, append a clear correction.
 * - When every claimed id is backed by a tool result, leave content unchanged.
 * - When there are no create claims, leave content unchanged.
 */
export function sanitizeBacklogCreateClaims(
  content: string,
  executedTools: readonly ExecutedToolLike[],
): { content: string; strippedClaimIds: string[]; verifiedIds: string[] } {
  const claimed = extractClaimedCreatedBacklogIds(content);
  if (claimed.length === 0) {
    return { content, strippedClaimIds: [], verifiedIds: [] };
  }

  const toolCreated = new Set(extractToolCreatedBacklogIds(executedTools));
  const verifiedIds = claimed.filter((id) => toolCreated.has(id));
  const strippedClaimIds = claimed.filter((id) => !toolCreated.has(id));

  if (strippedClaimIds.length === 0) {
    return { content, strippedClaimIds: [], verifiedIds };
  }

  // Soft rewrite: keep advice, but invalidate unproven create claims so the
  // operator never trusts a recycled BI id as "just created".
  let next = content;
  for (const id of strippedClaimIds) {
    // Soften "Created: BI-X" style claims without deleting surrounding advice.
    const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(
      new RegExp(`(?:created|filed|opened|added)\\s+(?:backlog\\s+item\\s+)?(?:as\\s+)?${idEsc}`, "gi"),
      `referenced existing id ${id} (not created this turn)`,
    );
    next = next.replace(
      new RegExp(`created:\\s*${idEsc}`, "gi"),
      `referenced (not created this turn): ${id}`,
    );
  }

  if (!next.includes("no backlog item was created in this turn")) {
    next = `${next.trimEnd()}\n\n${UNSUPPORTED_CREATE_NOTE}`;
  }

  return { content: next, strippedClaimIds, verifiedIds };
}

/**
 * Apply create-claim sanitization for the agentic loop. Logs when claims are
 * stripped so operators can find the incident in portal logs.
 */
export function applyBacklogCreateClaimGuard(
  content: string,
  executedTools: readonly ExecutedToolLike[],
): string {
  const guarded = sanitizeBacklogCreateClaims(content, executedTools);
  if (guarded.strippedClaimIds.length > 0) {
    console.warn(
      `[agentic-loop] BI-1BB7408D stripped unproven backlog create claims: ${guarded.strippedClaimIds.join(",")}`,
    );
  }
  return guarded.content;
}
