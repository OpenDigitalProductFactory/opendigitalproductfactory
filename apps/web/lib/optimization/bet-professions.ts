// Bet → profession routing (BI-9900B365, EP-8DC217EB BET-0c).
//
// Which profession family (WSID craft corpus, docs/professions/registry.json)
// works each Vertical-Integration consolidation bet. Consumed by the BET-0d
// dispatch harness to summon the right coworker, and by the profession
// decision gate so a bet's craft calls resolve against the right corpus.
// Pure data; the contract test validates every professionKey against the
// registry and every betKey against the consolidation-bet registry.
//
// Grounding: the 0c mapping in
// docs/superpowers/plans/2026-07-07-vertical-integration-inward-plan.md §9.

export type BetProfessionAssignment = {
  betKey: string;
  /** Profession families, primary first (registry professionKey values). */
  professionKeys: string[];
};

export const BET_PROFESSIONS: readonly BetProfessionAssignment[] = [
  { betKey: "BET-0", professionKeys: ["enterprise-architecture"] },
  { betKey: "BET-1", professionKeys: ["data-architect"] },
  { betKey: "BET-2", professionKeys: ["enterprise-architecture", "security"] },
  { betKey: "BET-3", professionKeys: ["software-engineer"] },
  { betKey: "BET-4", professionKeys: ["enterprise-architecture", "software-engineer"] },
  { betKey: "BET-5", professionKeys: ["enterprise-architecture", "strategy-executive"] },
  { betKey: "BET-6", professionKeys: ["software-engineer"] },
  { betKey: "BET-7", professionKeys: ["frontend-engineer"] },
  { betKey: "BET-8", professionKeys: ["enterprise-architecture", "devops-platform"] },
  { betKey: "BET-9", professionKeys: ["data-architect", "finance"] },
  { betKey: "BET-10", professionKeys: ["devops-platform"] },
  { betKey: "BET-11", professionKeys: ["software-engineer", "devops-platform"] },
  { betKey: "BET-12", professionKeys: ["security", "qa-engineer"] },
  { betKey: "BET-13", professionKeys: ["data-architect"] },
  { betKey: "BET-14", professionKeys: ["strategy-executive", "enterprise-architecture"] },
];

export function professionsForBet(betKey: string): string[] {
  return BET_PROFESSIONS.find((assignment) => assignment.betKey === betKey)?.professionKeys ?? [];
}
