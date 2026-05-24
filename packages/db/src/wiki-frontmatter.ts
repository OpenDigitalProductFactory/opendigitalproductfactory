// EP-WIKI-001: shared YAML-subset frontmatter parser used by both the
// kernel seed walker (seed-wiki-kernel.ts) and the apps/web ingest
// orchestrator (apps/web/lib/wiki/ingest.ts).
//
// Lives in its own module so apps/web can pull it through @dpf/db without
// dragging in seed-wiki-kernel.ts's `__dirname`-based KERNEL_DIR constant
// (which fails to evaluate under Vite's ESM/SSR loader).

import type { WikiPageKind, WikiPageStatus } from "./wiki-taxonomy";

// ─── Frontmatter shapes ─────────────────────────────────────────────────────

export type RawSourceFrontmatter = {
  sourceKey?: string;
  sourceType?: string;
  title?: string;
  authors?: string[];
  publishedAt?: string;
  url?: string;
  doi?: string;
  license?: string;
  abstract?: string;
};

export type WikiPageFrontmatter = {
  slug?: string;
  title: string;
  pageKind: WikiPageKind;
  status?: WikiPageStatus;
  abstract?: string;
  /** Source slugs (relative to raw-sources/) that this page cites. */
  sources?: string[];
  // ─── Principle-only frontmatter (spec section 9) ───
  // Required-field gating lives in lint detectors per spec section 14, not
  // here. The seed walker accepts incomplete principle data so lint can
  // surface findings on saved drafts.
  principleTier?: string;
  principleDirection?: string;
  principleWeight?: number;
  principleWeightRationale?: string;
  principleDimensionVector?: Record<string, number>;
  principleDimensions?: string[];
  principleAppliesTo?: string[];
  /** Consumer archetype — see spec §8A and §8A.1 coherence matrix. */
  principleConsumerArchetype?: string;
  /**
   * Route/domain context slugs (kebab-case) scoping a `route-domain-specific`
   * archetype. Empty / omitted for other archetypes. Required (≥1 entry) when
   * `principleConsumerArchetype = "route-domain-specific"`.
   */
  principleConsumerContexts?: string[];
  principlePublic?: boolean;
  principlePublicRationale?: string;
  // ─── Runtime enforcement (spec 2026-05-24, BI-43F95F77) ───
  // Optional. When non-empty, the principle is exposed to the runtime gate
  // at apps/web/lib/kernel/runtime-gate.ts. Authored as a single-line inline
  // JSON value (the parser supports `key: {...}` but NOT nested YAML blocks
  // or list-of-objects); a future parser-extension PR can lift this if more
  // keys want nested authoring.
  principleRuntimeEnforcement?: PrincipleRuntimeEnforcement;
};

/**
 * Runtime enforcement payload for tier-1 kernel commandments. Shape mirrored
 * by apps/web/lib/kernel/runtime-gate.ts (`EnforceablePrinciple.runtime`) so
 * the loader can pass parsed-frontmatter values straight through.
 */
export type PrincipleRuntimeEnforcement = {
  interactiveMode: "warn" | "confirm" | "refuse";
  autonomousMode: "warn" | "confirm" | "refuse";
  patterns: Array<
    | { kind: "shell"; regex: string; rationale: string }
    | { kind: "mcp_tool"; toolName: string; rationale: string }
    | { kind: "sql"; regex: string; rationale: string }
    | { kind: "git"; regex: string; rationale: string }
  >;
};

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Minimal YAML subset: scalars, inline arrays `[a, b]`, block-style lists
 * (`- item`), inline JSON objects (used for `principleDimensionVector`),
 * and typed coercion of unquoted true/false/numbers. Does not handle
 * nested objects beyond inline JSON.
 *
 * Throws on missing `---` delimiters so callers can distinguish "no
 * frontmatter" from "malformed frontmatter".
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  raw: string,
): { frontmatter: T; body: string } {
  const normalised = raw.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Missing YAML frontmatter delimiters (---)");
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const fm: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("#") || line.trim() === "") {
      i++;
      continue;
    }

    const kvMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // Block-style list:
    //   key:
    //     - item1
    //     - item2
    if (value === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const itemMatch = next.match(/^\s+-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
        j++;
      }
      if (items.length > 0) {
        fm[key] = items;
        i = j;
        continue;
      }
    }

    // Inline array: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
      i++;
      continue;
    }

    // Inline JSON object: { "key": value, ... }
    // Used primarily for principleDimensionVector. Authors must use JSON
    // syntax (quoted keys); YAML-style unquoted keys are not supported here.
    if (value.startsWith("{") && value.endsWith("}")) {
      try {
        fm[key] = JSON.parse(value);
        i++;
        continue;
      } catch {
        // Fall through to scalar handling if the JSON parse fails — better
        // to surface as a typed-value mismatch downstream than to silently
        // accept a malformed value.
      }
    }

    // Scalar (with optional surrounding quotes). Quoted values stay strings;
    // unquoted true/false/numbers coerce to their typed shape so principle
    // frontmatter (principlePublic: true, principleWeight: 0.85, etc.)
    // round-trips with the right type.
    const hasQuotes = /^["'].*["']$/.test(value);
    const scalarRaw = value.replace(/^["']|["']$/g, "");
    if (!hasQuotes && scalarRaw === "true") {
      fm[key] = true;
    } else if (!hasQuotes && scalarRaw === "false") {
      fm[key] = false;
    } else if (!hasQuotes && scalarRaw !== "" && /^-?\d+(\.\d+)?$/.test(scalarRaw)) {
      fm[key] = parseFloat(scalarRaw);
    } else {
      fm[key] = scalarRaw;
    }
    i++;
  }

  return { frontmatter: fm as T, body };
}

// ─── Wikilink extractor ─────────────────────────────────────────────────────

/**
 * Extract all `[[slug]]` tokens from a body. Returns deduped slugs.
 * Allowed slug characters: letters, digits, slashes, hyphens, underscores.
 */
export function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([a-zA-Z0-9/_-]+)\]\]/g);
  const slugs = new Set<string>();
  for (const m of matches) {
    if (m[1]) slugs.add(m[1]);
  }
  return Array.from(slugs);
}
