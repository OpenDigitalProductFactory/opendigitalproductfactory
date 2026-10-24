// Who should weigh in on a decision the kernel could not settle
// (BI-19B350FD, EP-0AF96937).
//
// WHY THIS IS NOT JUST A LOOKUP. The ledger's `domainClass` is coarse: on the
// live install every unresolved decision falls into one of five values
// (plan-readiness, kernel-consult, architecture-tradeoff, risk-assessment,
// professional-practice), which cannot tell a payroll question from a
// marketing one. So staffing reads three signals in priority order, and each
// one it uses it can name:
//
//   1. The profession gate itself. A WSID decision already knows its craft —
//      that is the strongest possible signal and needs no inference.
//   2. The decision's domain class, where the mapping is unambiguous.
//   3. Subject matter in the question text, for the axes a business actually
//      routes by: money, people, anything public, legal exposure, security.
//
// Signal 3 is a HEURISTIC and is labelled as one. When nothing matches, the
// answer is an empty roster and `uncovered: true` — the panel then runs on
// kernel doctrine alone and the card says so. Inventing a specialist is worse
// than admitting none applies: an owner who is told "your finance coworker
// reviewed this" when none did has been misled about the whole verdict.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.3

import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type StaffingSignal = "profession-gate" | "domain-class" | "subject-matter";

export type StaffedFamily = {
  professionKey: string;
  label: string;
  /** Which signal put this family on the panel. */
  via: StaffingSignal;
  /** The live coworker names this family binds, for roster resolution. */
  roleKeys: readonly string[];
};

export type StaffingPlan = {
  families: StaffedFamily[];
  /** True when no profession could be justified — the panel runs kernel-only. */
  uncovered: boolean;
  /** Plain sentence naming what the staffing was based on. */
  basis: string;
};

export type StaffingInput = {
  domainClass: string | null;
  gateKey: string | null;
  /** Set when the decision came from a profession (WSID) gate. */
  professionKey?: string | null;
  question: string;
};

/** At most this many specialists — a panel is a review, not a committee. */
export const MAX_STAFFED_FAMILIES = 3;

/* -------------------------------------------------------------------------- */
/* Signal 2 — domain class, only where it is unambiguous                      */
/* -------------------------------------------------------------------------- */

const DOMAIN_FAMILIES: Record<string, readonly string[]> = {
  "architecture-tradeoff": ["enterprise-architecture", "software-engineer"],
  "risk-assessment": ["security", "legal-compliance"],
  "plan-readiness": ["portfolio-management"],
  // Deliberately absent: kernel-consult and professional-practice say nothing
  // about subject matter, so they contribute no family on their own.
};

/* -------------------------------------------------------------------------- */
/* Signal 3 — subject matter (a heuristic, labelled as one)                    */
/* -------------------------------------------------------------------------- */

/**
 * The axes a business actually routes decisions by. Each term is one a
 * non-technical owner would recognise as belonging to that function — the test
 * is "would a person hand this to that department", not keyword density.
 */
const SUBJECT_TERMS: Record<string, readonly string[]> = {
  finance: [
    "invoice", "payment", "refund", "price", "pricing", "cost", "budget",
    "revenue", "billing", "payroll", "tax", "expense", "spend", "margin",
  ],
  "hr-people-ops": [
    "employee", "hire", "hiring", "candidate", "staff", "leave", "time off",
    "performance review", "onboarding", "termination", "contractor",
  ],
  "legal-compliance": [
    "contract", "agreement", "licence", "license", "liability", "consent",
    "terms", "regulat", "gdpr", "compliance", "dpa", "policy breach",
  ],
  security: [
    "credential", "secret", "token", "breach", "vulnerab", "access control",
    "permission", "exposure", "attack", "encrypt",
  ],
  marketing: [
    "campaign", "publish", "announce", "brand", "audience", "outreach",
    "social", "newsletter", "press",
  ],
  operations: [
    "incident", "outage", "downtime", "capacity", "dispatch", "schedule",
    "supplier", "inventory",
  ],
  "customer-success": ["customer", "client", "churn", "complaint", "escalation from"],
};

function familyLabel(professionKey: string): string | null {
  const family = PROFESSION_REGISTRY.families.find((f) => f.professionKey === professionKey);
  return family?.label ?? null;
}

function roleKeys(professionKey: string): readonly string[] {
  const family = PROFESSION_REGISTRY.families.find((f) => f.professionKey === professionKey);
  return family?.roles ?? [];
}

function toStaffed(professionKey: string, via: StaffingSignal): StaffedFamily | null {
  const label = familyLabel(professionKey);
  // A key the registry does not carry is a config error, not a silent pass.
  if (!label) return null;
  return { professionKey, label, via, roleKeys: roleKeys(professionKey) };
}

/** Subject-matter families whose terms appear in the question. */
export function subjectMatterFamilies(question: string): string[] {
  const haystack = question.toLowerCase();
  return Object.entries(SUBJECT_TERMS)
    .filter(([, terms]) => terms.some((term) => haystack.includes(term)))
    .map(([professionKey]) => professionKey);
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                       */
/* -------------------------------------------------------------------------- */

const BASIS: Record<StaffingSignal, string> = {
  "profession-gate": "the craft this decision was already filed under",
  "domain-class": "the kind of decision it is",
  "subject-matter": "what the question is about",
};

/**
 * Decide which professions should sit on the panel. Ordered strongest-signal
 * first and capped, so a question mentioning six things does not convene six
 * specialists. Returns an uncovered plan rather than a guess when nothing
 * justifies a specialist.
 */
export function planTriageStaffing(input: StaffingInput): StaffingPlan {
  const chosen: StaffedFamily[] = [];
  const seen = new Set<string>();

  const add = (professionKey: string, via: StaffingSignal) => {
    if (seen.has(professionKey) || chosen.length >= MAX_STAFFED_FAMILIES) return;
    const staffed = toStaffed(professionKey, via);
    if (!staffed) return;
    seen.add(professionKey);
    chosen.push(staffed);
  };

  if (input.gateKey === "profession" && input.professionKey) {
    add(input.professionKey, "profession-gate");
  }
  for (const key of subjectMatterFamilies(input.question)) add(key, "subject-matter");
  for (const key of DOMAIN_FAMILIES[input.domainClass ?? ""] ?? []) add(key, "domain-class");

  if (chosen.length === 0) {
    return {
      families: [],
      uncovered: true,
      basis:
        "No profession could be matched to this decision, so it was weighed on general platform doctrine alone.",
    };
  }

  const signals = [...new Set(chosen.map((f) => f.via))].map((via) => BASIS[via]);
  return {
    families: chosen,
    uncovered: false,
    basis: `Staffed from ${signals.join(", and ")}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Roster resolution                                                          */
/* -------------------------------------------------------------------------- */

export type RosterCandidate = { agentId: string; name: string; displayName: string | null };

export type StaffedCoworker = {
  professionKey: string;
  agentId: string;
  displayName: string;
};

/** Registry role keys and live agent names differ in case and separators. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Bind the planned families to coworkers this install actually has. A family
 * with no live coworker is dropped from the roster and reported, because a
 * panel seat nobody can fill is not a panel seat.
 */
export function resolveStaffedCoworkers(
  plan: StaffingPlan,
  roster: readonly RosterCandidate[],
): { staffed: StaffedCoworker[]; unstaffedFamilies: string[] } {
  const byNormalizedName = new Map<string, RosterCandidate>();
  for (const candidate of roster) {
    byNormalizedName.set(normalize(candidate.name), candidate);
  }

  const staffed: StaffedCoworker[] = [];
  const unstaffedFamilies: string[] = [];

  for (const family of plan.families) {
    const match = family.roleKeys
      .map((key) => byNormalizedName.get(normalize(key)))
      .find((candidate): candidate is RosterCandidate => candidate !== undefined);
    if (!match) {
      unstaffedFamilies.push(family.label);
      continue;
    }
    staffed.push({
      professionKey: family.professionKey,
      agentId: match.agentId,
      displayName: match.displayName || match.name,
    });
  }

  return { staffed, unstaffedFamilies };
}
