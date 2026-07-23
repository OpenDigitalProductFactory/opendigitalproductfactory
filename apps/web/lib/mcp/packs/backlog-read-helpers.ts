// Shared read helpers for the governed MCP backlog surface (BI-EC9471C7).
//
// query_backlog, list_epics and list_backlog_items all page results and all
// accept an epic filter, and they used to do both inconsistently — one resolved
// the epic row, another wrote the semantic id straight into the cuid FK column.
// Both concerns live here so the three handlers cannot drift again.

type DbPrisma = (typeof import("@dpf/db"))["prisma"];

// Read caps. These bound a single response; they do not hide rows. Every capped
// list reports `total` and `truncated` so a caller can tell the difference
// between "that is all of them" and "you only got the first page" — silent
// truncation reads as absence, which is worse than a large response.
export const BACKLOG_LIST_LIMIT_MAX = 1000;
export const BACKLOG_LIST_LIMIT_DEFAULT = 100;

export function resolveListLimit(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(Math.max(1, Math.floor(raw)), BACKLOG_LIST_LIMIT_MAX)
    : BACKLOG_LIST_LIMIT_DEFAULT;
}

// `BacklogItem.epicId` is the internal cuid FK, NOT the semantic `EP-*` id.
// Filtering it by the semantic id matches nothing and returns an empty list
// with no error, so callers must resolve the row first. Returns undefined when
// no epic id was supplied, or null when one was supplied but matched nothing —
// the caller turns null into epic_not_found rather than an empty result.
export async function resolveEpicRowId(
  prisma: DbPrisma,
  raw: unknown,
): Promise<string | null | undefined> {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const epicRow = await prisma.epic.findFirst({
    where: { OR: [{ epicId: raw.trim() }, { id: raw.trim() }] },
    select: { id: true },
  });
  return epicRow ? epicRow.id : null;
}
