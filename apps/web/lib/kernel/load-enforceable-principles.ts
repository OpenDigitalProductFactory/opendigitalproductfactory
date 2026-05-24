/**
 * Loader that reads tier-1 commandments with runtime-enforcement payloads
 * from the principle wiki and shapes them into the `EnforceablePrinciple[]`
 * the runtime gate consumes.
 *
 * Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
 * Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md
 *
 * Caching: process-lifetime in-memory cache. The MCP dispatcher and the
 * shell-guard API route both hit this on every call; a Postgres roundtrip
 * per dispatch would tank throughput. Slice 1 invalidates only on portal
 * restart (matches how principle-recall warms its cache today); slice 2+
 * can wire a TTL or write-time invalidation when commandments change at
 * runtime more often than they do today (today: rarely).
 *
 * Test hook: when DPF_TEST_MCP_REFUSE_PROBE=1, the loader appends one
 * hardcoded synthetic principle that matches the mcp_tool toolName
 * `dpf_test_kernel_refuse_probe` with refuse mode in both session
 * classes. The synthetic principle never persists to the DB and is
 * filtered out by env check; it exists only to make the Phase 9 live
 * verification of the MCP dispatcher reproducible without contaminating
 * the production wiki.
 */

import { prisma } from "@dpf/db";
import type { EnforceablePrinciple } from "./runtime-gate";

let cached: EnforceablePrinciple[] | null = null;

/** Test-only: drop the cache so the next call re-queries Postgres. */
export function __resetCacheForTest(): void {
  cached = null;
}

const SYNTHETIC_PROBE: EnforceablePrinciple = {
  id: "__synthetic_probe__",
  slug: "__synthetic_refuse_probe__",
  tier: "commandment",
  runtime: {
    interactiveMode: "refuse",
    autonomousMode: "refuse",
    patterns: [
      {
        kind: "mcp_tool",
        toolName: "dpf_test_kernel_refuse_probe",
        rationale: "synthetic probe (DPF_TEST_MCP_REFUSE_PROBE)",
      },
    ],
  },
};

function maybeAppendSynthetic(base: EnforceablePrinciple[]): EnforceablePrinciple[] {
  return process.env.DPF_TEST_MCP_REFUSE_PROBE === "1"
    ? [...base, SYNTHETIC_PROBE]
    : base;
}

const TIER_VALUES = new Set(["commandment", "core", "contextual"]);
const MODE_VALUES = new Set(["warn", "confirm", "refuse"]);

type WikiPageRow = {
  id: string;
  slug: string;
  principleTier: string | null;
  principleRuntimeEnforcement: unknown;
};

function shapeOf(row: WikiPageRow): EnforceablePrinciple | null {
  if (!row.principleTier || !TIER_VALUES.has(row.principleTier)) return null;
  const r = row.principleRuntimeEnforcement;
  if (!r || typeof r !== "object") return null;
  const obj = r as Record<string, unknown>;
  if (!MODE_VALUES.has(String(obj.interactiveMode))) return null;
  if (!MODE_VALUES.has(String(obj.autonomousMode))) return null;
  const patterns = Array.isArray(obj.patterns) ? obj.patterns : [];
  if (patterns.length === 0) return null;
  return {
    id: row.id,
    slug: row.slug,
    tier: row.principleTier as EnforceablePrinciple["tier"],
    runtime: {
      interactiveMode: obj.interactiveMode as EnforceablePrinciple["runtime"]["interactiveMode"],
      autonomousMode: obj.autonomousMode as EnforceablePrinciple["runtime"]["autonomousMode"],
      patterns: patterns as EnforceablePrinciple["runtime"]["patterns"],
    },
  };
}

export async function loadEnforceablePrinciples(): Promise<EnforceablePrinciple[]> {
  if (cached !== null) return maybeAppendSynthetic(cached);
  const rows = await prisma.wikiPage.findMany({
    where: {
      pageKind: "principle",
      NOT: { principleRuntimeEnforcement: { equals: null as unknown as object } },
    },
    select: {
      id: true,
      slug: true,
      principleTier: true,
      principleRuntimeEnforcement: true,
    },
  });
  const shaped = (rows as unknown as WikiPageRow[])
    .map(shapeOf)
    .filter((p): p is EnforceablePrinciple => p !== null);
  cached = shaped;
  return maybeAppendSynthetic(shaped);
}
