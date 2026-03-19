// apps/web/lib/api/pagination.ts
//
// Cursor-based pagination helpers for REST API endpoints.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parse pagination parameters from a URL search params object.
 * Returns `{ cursor, limit }` with sensible defaults.
 */
export function parsePagination(searchParams: URLSearchParams): {
  cursor: string | null;
  limit: number;
} {
  const cursor = searchParams.get("cursor") || null;
  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isNaN(rawLimit) || rawLimit <= 0
      ? DEFAULT_LIMIT
      : Math.min(rawLimit, MAX_LIMIT);

  return { cursor, limit };
}

/**
 * Build a paginated response from a fetched item list.
 *
 * Callers should query for `limit + 1` rows. If the result set is larger
 * than `limit`, the extra item indicates more pages exist:
 * - Return only the first `limit` items
 * - Set `nextCursor` to the last returned item's `id`
 *
 * If the result set is <= `limit`, all data has been returned and
 * `nextCursor` is null.
 */
export function buildPaginatedResponse<T extends { id: string }>(
  items: T[],
  limit: number,
): { data: T[]; nextCursor: string | null } {
  if (items.length <= limit) {
    return { data: items, nextCursor: null };
  }

  const data = items.slice(0, limit);
  const nextCursor = data[data.length - 1]?.id ?? null;
  return { data, nextCursor };
}
