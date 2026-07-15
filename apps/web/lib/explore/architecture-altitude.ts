// Architecture-altitude classifier for Build Studio suitability (BI-4A30D8AC).
// Kernel: docs/founder-kernel/wiki/principles/build-studio-suitability-boundary.md
// Pure — unit-tested; used by promote_to_build_studio and triage advisors.

export type ArchitectureAltitude = "functional" | "core-platform";

export type ArchitectureAltitudeVerdict = {
  altitude: ArchitectureAltitude;
  /** Operator-facing reason when altitude is core-platform; null for functional. */
  reason: string | null;
  /** Matched signal labels for audit (empty when functional). */
  signals: string[];
};

const CORE_PLATFORM_WORK_TYPES = new Set(["refactor"]);

/** Title/body tokens that signal substrate / core-platform altitude. */
const CORE_PLATFORM_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "schema-prisma", re: /\bschema\.prisma\b|prisma\s+schema\b/i },
  { id: "data-layer-migration", re: /\b(data[- ]layer|schema)\s+migration\b|\bmigrate\s+dev\b|\bprisma\s+migrate\b/i },
  { id: "datastore", re: /\b(neo4j|qdrant|pgvector|postgres(?:ql)?\s+only|datastore\s+swap|retire\s+(?:neo4j|qdrant))\b/i },
  { id: "cross-cutting-substrate", re: /\b(cross[- ]cutting\s+substrate|core[- ]platform|substrate\s+work|platform[- ]spine)\b/i },
  { id: "authz-spine", re: /\b(authorization|authz)\s+spine\b|\beffectivepermission\b|\bprincipal\s+convergence\b/i },
  { id: "mcp-tool-pack-migration", re: /\bmcp\s+tool[- ]pack\s+migration\b|\b234[- ]case\s+switch\b/i },
  { id: "bet-refactor", re: /\bBET-\d+\b/i },
  { id: "workunit-spine", re: /\bworkunit\s+spine\b|\bone\s+spine\s*\+\s*typed\s+role\b/i },
];

/**
 * Classify whether a backlog item is customer-functional (Build Studio OK)
 * or architecturally-heavy core-platform work (direct expert build).
 *
 * Signals are OR'd; any match elevates to core-platform. workType=refactor
 * alone is enough (BET-style platform refactors).
 */
export function classifyArchitectureAltitude(input: {
  title?: string | null;
  body?: string | null;
  workType?: string | null;
}): ArchitectureAltitudeVerdict {
  const signals: string[] = [];
  const workType = (input.workType ?? "").trim().toLowerCase();
  if (CORE_PLATFORM_WORK_TYPES.has(workType)) {
    signals.push(`workType=${workType}`);
  }
  const text = `${input.title ?? ""}\n${input.body ?? ""}`;
  for (const { id, re } of CORE_PLATFORM_PATTERNS) {
    if (re.test(text)) signals.push(id);
  }
  if (signals.length === 0) {
    return { altitude: "functional", reason: null, signals: [] };
  }
  return {
    altitude: "core-platform",
    reason:
      "Architecture altitude is core-platform — Build Studio is for end-customer functional builds. " +
      "Route this to a direct expert build (single serialized author), not promote_to_build_studio. " +
      `Signals: ${signals.join(", ")}. ` +
      "See docs/founder-kernel/wiki/principles/build-studio-suitability-boundary.md. " +
      "Pass force=true only for an explicit override after human confirmation.",
    signals,
  };
}

export function isCorePlatformAltitude(input: {
  title?: string | null;
  body?: string | null;
  workType?: string | null;
}): boolean {
  return classifyArchitectureAltitude(input).altitude === "core-platform";
}
