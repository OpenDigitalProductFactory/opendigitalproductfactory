/**
 * Governed per-domain match/merge configuration (BI-37F52B70 / BI-16450BB2).
 *
 * Operator-tunable thresholds for the dedup gate + batch scan, and the
 * survivorship mode the merge applies. Stored as one MdmMatchConfig JSON row
 * per domain; code defaults are the fallback so a missing/malformed row can
 * never break matching (Informatica-style declarative rules, DPF-governed:
 * changes are audited via updatedBy + attribute history).
 */
import { prisma } from "@dpf/db";
import { z } from "zod";
import type { DedupGatedDomain } from "./dedup-gate";

export const matchConfigSchema = z.object({
  /** Trigram blocking floor for candidate generation (recall-oriented). */
  trgmFloor: z.number().min(0.05).max(0.9).default(0.3),
  /** Score at/above which a pair is a possible-duplicate. */
  possibleThreshold: z.number().min(0.1).max(1).default(0.45),
  /** Score at/above which a pair is a likely-duplicate. */
  likelyThreshold: z.number().min(0.2).max(2).default(0.7),
  /**
   * Survivorship on merge: keep-survivor (v1 default before this slice) or
   * fill-empty (survivor keeps its values; empty survivor fields are filled
   * from the loser — completeness rule, recorded in the merge audit).
   */
  survivorship: z.enum(["keep-survivor", "fill-empty"]).default("fill-empty"),
  /** Days without update before an active record is swept as stale. */
  staleAfterDays: z.number().int().min(7).max(3650).default(180),
});

export type MatchConfig = z.infer<typeof matchConfigSchema>;

export const MATCH_CONFIG_DEFAULTS: MatchConfig = matchConfigSchema.parse({});

/** Load the effective config for a domain (code defaults on any failure). */
export async function loadMatchConfig(domain: DedupGatedDomain): Promise<MatchConfig> {
  try {
    const row = await prisma.mdmMatchConfig.findUnique({ where: { domain } });
    if (!row) return MATCH_CONFIG_DEFAULTS;
    const parsed = matchConfigSchema.safeParse(row.config);
    return parsed.success ? parsed.data : MATCH_CONFIG_DEFAULTS;
  } catch {
    return MATCH_CONFIG_DEFAULTS;
  }
}

/** Persist a (partial) config for a domain; returns the effective config. */
export async function saveMatchConfig(
  domain: DedupGatedDomain,
  config: Partial<MatchConfig>,
  updatedBy: string | null,
): Promise<MatchConfig> {
  const current = await loadMatchConfig(domain);
  const next = matchConfigSchema.parse({ ...current, ...config });
  await prisma.mdmMatchConfig.upsert({
    where: { domain },
    create: { domain, config: next, updatedBy },
    update: { config: next, updatedBy },
  });
  return next;
}
