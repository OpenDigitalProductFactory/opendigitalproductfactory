// Golden journeys — the per-coworker certification probes (EP-COWORKER-LIFECYCLE
// Phase 2, BI-DE9CC88B).
//
// A golden journey is a small, non-destructive prompt sent through the REAL
// coworker execution path (real persona, real tool surface, real routing) whose
// outcome the certification oracles can judge mechanically. Every roster
// coworker gets a DERIVED journey automatically — generated from its Phase 1
// definition rather than hand-authored — so a newly established coworker is
// exercised on the next certification sweep with zero extra work. Curated
// journeys can be added per coworker where a domain-specific probe is more
// valuable; they replace the derived one.
//
// Journeys must stay side-effect free: the runner restricts the tool surface
// to sideEffect=false tools, and prompts instruct read-only behavior. A
// journey that needs a write does not belong here — that is sim-harness
// territory.

export type GoldenJourney = {
  /** Stable id — used in AssuranceRun summaries and finding keys. */
  journeyId: string;
  agentId: string;
  mode: "act" | "advise";
  prompt: string;
  kind: "derived" | "curated";
};

/**
 * The derived probe: role-agnostic, works for any coworker with at least one
 * read-only tool. The oracles judge it by evidence, not by prose: a passing
 * run has ≥1 successful tool call and no fabrication/false-refusal pattern.
 */
export function derivedReadProbe(agentId: string): GoldenJourney {
  return {
    journeyId: `${agentId}/derived-read-probe`,
    agentId,
    mode: "act",
    kind: "derived",
    prompt: [
      "Certification probe (read-only).",
      "Use one of your available tools to retrieve one concrete piece of current data relevant to your role,",
      "then report which tool you used and one specific fact from its output.",
      "Do not invent data. If every tool call fails, reply with TOOL-FAILURE and name the tool you tried.",
      "Do not create, modify, or delete anything.",
    ].join(" "),
  };
}

/**
 * Curated journeys — richer domain probes that replace the derived one.
 * Keyed by agentId; each entry must remain read-only.
 */
export const CURATED_JOURNEYS: Readonly<Record<string, readonly Omit<GoldenJourney, "agentId" | "kind">[]>> = {
  "marketing-specialist": [
    {
      journeyId: "marketing-specialist/campaign-readiness-review",
      mode: "act",
      prompt:
        "Certification probe (read-only). Review the current marketing campaigns using your tools and report: how many campaigns exist, and one concrete detail of the most recent one. Do not create or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "inventory-specialist": [
    {
      journeyId: "inventory-specialist/estate-census",
      mode: "act",
      prompt:
        "Certification probe (read-only). Using your registry tools, report how many digital products are currently tracked and name one of them. Do not create or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
  "ops-coordinator": [
    {
      journeyId: "ops-coordinator/backlog-pulse",
      mode: "act",
      prompt:
        "Certification probe (read-only). Using your backlog tools, report how many open backlog items you can see and the title of one of them. Do not create, triage, or modify anything. If tools fail, reply TOOL-FAILURE and name the tool.",
    },
  ],
};

export function journeysForCoworker(agentId: string): GoldenJourney[] {
  const curated = CURATED_JOURNEYS[agentId];
  if (curated && curated.length > 0) {
    return curated.map((j) => ({ ...j, agentId, kind: "curated" as const }));
  }
  return [derivedReadProbe(agentId)];
}
