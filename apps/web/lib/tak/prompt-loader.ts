// apps/web/lib/tak/prompt-loader.ts
// Cache-aware DB loader for prompt templates.
// Falls back to hardcoded constants if DB row is missing or disabled.

import { prisma } from "@dpf/db";

type CacheEntry = {
  content: string;
  composesFrom: string[];
  loadedAt: number;
};

const CACHE_TTL_MS = 60_000; // 60 seconds

/** In-memory prompt cache. Process-scoped, invalidated on admin edits. */
const cache = new Map<string, CacheEntry>();

function cacheKey(category: string, slug: string): string {
  return `${category}/${slug}`;
}

/**
 * Load a single prompt template by category/slug.
 * Returns the prompt content with {{include:...}} markers resolved.
 * Falls back to the provided default if DB row doesn't exist or is disabled.
 */
export async function loadPrompt(
  category: string,
  slug: string,
  fallbackContent?: string,
): Promise<string> {
  const key = cacheKey(category, slug);

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return resolveIncludes(cached.content, cached.composesFrom);
  }

  // Query DB
  try {
    const row = await prisma.promptTemplate.findUnique({
      where: { category_slug: { category, slug } },
      select: { content: true, composesFrom: true, enabled: true },
    });

    if (row && row.enabled) {
      const entry: CacheEntry = {
        content: row.content,
        composesFrom: row.composesFrom,
        loadedAt: Date.now(),
      };
      cache.set(key, entry);
      return resolveIncludes(entry.content, entry.composesFrom);
    }
  } catch {
    // DB unavailable — cache the fallback to avoid repeated connection attempts
    const fallback = fallbackContent ?? "";
    cache.set(key, { content: fallback, composesFrom: [], loadedAt: Date.now() });
    return fallback;
  }

  // Fallback to hardcoded constant
  return fallbackContent ?? "";
}

/**
 * Load multiple prompt templates in a single batch query.
 * Returns a Map keyed by "category/slug".
 */
export async function loadPrompts(
  refs: Array<{ category: string; slug: string; fallback?: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uncached: typeof refs = [];

  // Serve from cache where possible
  for (const ref of refs) {
    const key = cacheKey(ref.category, ref.slug);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      result.set(key, resolveIncludes(cached.content, cached.composesFrom));
    } else {
      uncached.push(ref);
    }
  }

  if (uncached.length === 0) return result;

  // Batch query for uncached
  try {
    const rows = await prisma.promptTemplate.findMany({
      where: {
        OR: uncached.map((r) => ({ category: r.category, slug: r.slug })),
      },
      select: { category: true, slug: true, content: true, composesFrom: true, enabled: true },
    });

    type PromptRow = { category: string; slug: string; content: string; composesFrom: string[]; enabled: boolean };
    const rowMap = new Map<string, PromptRow>(rows.map((r: PromptRow) => [cacheKey(r.category, r.slug), r]));

    for (const ref of uncached) {
      const key = cacheKey(ref.category, ref.slug);
      const row = rowMap.get(key);
      if (row && row.enabled) {
        const entry: CacheEntry = {
          content: row.content,
          composesFrom: row.composesFrom,
          loadedAt: Date.now(),
        };
        cache.set(key, entry);
        result.set(key, resolveIncludes(entry.content, entry.composesFrom));
      } else {
        result.set(key, ref.fallback ?? "");
      }
    }
  } catch {
    // DB unavailable — use fallbacks and cache them to avoid repeated connection attempts
    for (const ref of uncached) {
      const key = cacheKey(ref.category, ref.slug);
      const fallback = ref.fallback ?? "";
      cache.set(key, { content: fallback, composesFrom: [], loadedAt: Date.now() });
      result.set(key, fallback);
    }
  }

  return result;
}

/**
 * Invalidate cache entries. Called by admin save actions.
 * No args = invalidate all. With args = invalidate specific entry.
 */
export function invalidatePromptCache(category?: string, slug?: string): void {
  if (category && slug) {
    cache.delete(cacheKey(category, slug));
  } else {
    cache.clear();
  }
}

/**
 * Resolve {{include:category/slug}} markers in prompt content.
 * Max depth 3 to prevent cycles. Synchronous resolution from cache only —
 * includes must already be loaded (the seed script ensures all prompts exist).
 */
function resolveIncludes(content: string, composesFrom: string[], depth = 0): string {
  if (depth > 3 || !content.includes("{{include:")) return content;

  return content.replace(/\{\{include:([^}]+)\}\}/g, (_match, ref: string) => {
    const [cat, sl] = ref.split("/");
    if (!cat || !sl) return _match;

    const cached = cache.get(cacheKey(cat, sl));
    if (cached) {
      return resolveIncludes(cached.content, cached.composesFrom, depth + 1);
    }

    // If the include isn't cached yet, leave the marker (will be resolved on next load)
    return _match;
  });
}
