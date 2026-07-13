// EP-0AF96937 Phase 1: derive the three decision-discipline cards for the
// decision-governance landing hub from live counts.
//
// Pure — takes already-queried numbers and returns presentational card models.
// The page does the Prisma I/O and passes the counts in, so this is unit
// testable and does no DB work itself.

import type {
  DisciplineCardModel,
} from "@/components/wiki/DecisionDisciplineHub";

/** Live signals the page derives and feeds to the card builder. */
export type DisciplineHealthInput = {
  /** Kernel (platform) principle pages — the WWMD material weight. */
  kernelPrincipleCount: number;
  /** Kernel heuristic pages. */
  kernelHeuristicCount: number;
  /**
   * True when the organization has authored its own WWWD stance material
   * (an organization-kind profile with at least one org-scoped material row),
   * rather than inheriting platform doctrine as advisory-only.
   */
  orgHasOwnWwwdStance: boolean;
  /** Unresolved (defer/escalate) decisions on the platform (WWMD) profile. */
  wwmdOpenReviews: number;
  /** Unresolved (defer/escalate) decisions on the organization (WWWD) profile. */
  wwwdOpenReviews: number;
  /** Number of WSID profession families the platform covers. */
  wsidFamilyCount: number;
  /** Active profession (WSID) profiles seeded. */
  wsidActiveProfiles: number;
  /** Unresolved decisions across profession (WSID) profiles. */
  wsidOpenReviews: number;
  /** Ledger decisions recorded in the last 30 days, per tier (audit signal). */
  wwmdDecisions30d: number;
  wwwdDecisions30d: number;
  wsidDecisions30d: number;
};

function reviewChipLabel(count: number): string {
  return count === 1 ? "1 open review" : `${count} open reviews`;
}

/**
 * Usage chip for a tier's decision ledger: green when decisions are flowing,
 * warning when the tier is silent — a silent tier means the gate exists but
 * is not being exercised, which is itself the finding the hub must surface.
 */
function usageChip(decisions30d: number): { label: string; tone: "success" | "warning" } {
  return decisions30d > 0
    ? {
      label: decisions30d === 1 ? "1 decision · 30d" : `${decisions30d} decisions · 30d`,
      tone: "success",
    }
    : { label: "no decisions recorded", tone: "warning" };
}

/**
 * Build the WWMD / WWWD / WSID discipline cards. Order is deliberate: platform
 * doctrine first (the baseline everything inherits from), then the business's
 * own doctrine (the one it most owns and is accented), then per-role craft.
 */
export function buildDisciplineCards(
  input: DisciplineHealthInput,
): DisciplineCardModel[] {
  const wwmd: DisciplineCardModel = {
    key: "wwmd",
    code: "WWMD",
    expansion: "What would Mark do",
    blurb: "How the platform itself decides how to build.",
    chips: [
      { label: `${input.kernelPrincipleCount} principles`, tone: "neutral" },
      { label: `${input.kernelHeuristicCount} heuristics`, tone: "neutral" },
      usageChip(input.wwmdDecisions30d),
      ...(input.wwmdOpenReviews > 0
        ? [{ label: reviewChipLabel(input.wwmdOpenReviews), tone: "warning" as const }]
        : []),
    ],
    actions: [
      { label: "Governing material", href: "#governing-material" },
      { label: "Decision log", href: "/coworker-decisions/decisions?tier=wwmd" },
      { label: "Review decisions", href: "/coworker-decisions/review" },
    ],
  };

  const wwwd: DisciplineCardModel = {
    key: "wwwd",
    code: "WWWD",
    expansion: "What would we do",
    blurb: "How your business decides — priorities, funding, customer calls.",
    featured: true,
    chips: [
      input.orgHasOwnWwwdStance
        ? { label: "your own stance", tone: "success" }
        : { label: "no stance of your own yet", tone: "warning" },
      usageChip(input.wwwdDecisions30d),
      ...(input.wwwdOpenReviews > 0
        ? [{ label: reviewChipLabel(input.wwwdOpenReviews), tone: "warning" as const }]
        : []),
    ],
    actions: [
      { label: "Manage stance", href: "/coworker-decisions/stance", emphasis: true },
      { label: "Decision log", href: "/coworker-decisions/decisions?tier=wwwd" },
      { label: "Review decisions", href: "/coworker-decisions/review" },
    ],
  };

  const wsid: DisciplineCardModel = {
    key: "wsid",
    code: "WSID",
    expansion: "What should I do",
    blurb: "What a competent professional in each role should do.",
    chips: [
      { label: `${input.wsidFamilyCount} role families`, tone: "neutral" },
      {
        label:
          input.wsidActiveProfiles === 1
            ? "1 corpus active"
            : `${input.wsidActiveProfiles} corpora active`,
        tone: "neutral",
      },
      usageChip(input.wsidDecisions30d),
      ...(input.wsidOpenReviews > 0
        ? [{ label: reviewChipLabel(input.wsidOpenReviews), tone: "warning" as const }]
        : []),
    ],
    actions: [
      { label: "Role craft", href: "/coworker-decisions/craft", emphasis: true },
      { label: "Decision log", href: "/coworker-decisions/decisions?tier=wsid" },
      { label: "Review decisions", href: "/coworker-decisions/review" },
    ],
  };

  return [wwmd, wwwd, wsid];
}
