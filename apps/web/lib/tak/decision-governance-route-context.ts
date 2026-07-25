import { Prisma, prisma } from "@dpf/db";
import {
  WWMD_PLATFORM_PROFILE_ID,
  WWWD_ORGANIZATION_PROFILE_ID,
} from "@/lib/decision/caller-context";
import { resolveOrgProfileId } from "@/lib/decision-perspective/material";
import {
  dedupeFounderReviewCandidates,
  isFounderActionable,
  isBlankFounderReviewQuestion,
  projectFounderReviewCandidate,
  type DecisionInteractionQueueRow,
} from "@/lib/founder-review/queue";

// EP-0AF96937 / BI-C888E1B6. The /coworker-decisions landing is the Decision
// Governance hub: WWMD, WWWD, and WSID open reviews awaiting a human.
const WIKI_UNRESOLVED_OUTCOMES = ["defer", "escalate"];

function openDecisionReviewWhere(
  profileId?: Prisma.DecisionInteractionWhereInput["profileId"],
): Prisma.DecisionInteractionWhereInput {
  return {
    outcomeType: { in: WIKI_UNRESOLVED_OUTCOMES },
    humanOutcome: { equals: Prisma.DbNull },
    question: { not: "" },
    // Mirror of isFounderActionable at the DB (BI-6EC1EE25): advisory
    // profession/WSID rows and already-executed agent-internal consults are not
    // reviews awaiting a human. A craft "defer" is a corpus-growth signal
    // (ProfessionCorpusGap), not a founder decision.
    NOT: [
      { gateKey: "profession" },
      {
        buildId: null,
        taskRunId: null,
        OR: [
          { routeContext: { startsWith: "mcp:principle_decide" } },
          { domainClass: "kernel-consult" },
        ],
      },
    ],
    ...(profileId !== undefined ? { profileId } : {}),
  };
}

const openDecisionReviewSelect = {
  interactionId: true,
  question: true,
  options: true,
  outcomeType: true,
  outcomePayload: true,
  buildId: true,
  taskRunId: true,
  routeContext: true,
  domainClass: true,
  gateKey: true,
  createdAt: true,
  profile: { select: { profileId: true, name: true, kind: true } },
} satisfies Prisma.DecisionInteractionSelect;

function countUniqueOpenReviews(rows: DecisionInteractionQueueRow[]): number {
  const candidates = rows
    .filter((row) => !isBlankFounderReviewQuestion(row))
    .filter((row) => isFounderActionable(row))
    .map((row) => projectFounderReviewCandidate(row));
  return dedupeFounderReviewCandidates(candidates).length;
}

export async function getWikiGovernanceContext(): Promise<string> {
  const decisionWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;
  const orgProfileId = organizationId
    ? await resolveOrgProfileId({ db: prisma, organizationId })
    : null;
  const wwwdProfileIds = orgProfileId
    ? [orgProfileId, WWWD_ORGANIZATION_PROFILE_ID]
    : [WWWD_ORGANIZATION_PROFILE_ID];

  const [
    kernelPrincipleCount,
    kernelHeuristicCount,
    wsidActiveProfiles,
    wwmdOpenReviewRows,
    wwwdOpenReviewRows,
    wsidOpenReviewRows,
    wwmdDecisions30d,
    wwwdDecisions30d,
    wsidDecisions30d,
    topOpenReviews,
  ] = await Promise.all([
    prisma.wikiPage.count({
      where: { organizationId: null, pageKind: "principle", status: "published" },
    }),
    prisma.wikiPage.count({
      where: { organizationId: null, pageKind: "heuristic", status: "published" },
    }),
    prisma.decisionPerspectiveProfile.count({
      where: { kind: "profession", status: "active" },
    }),
    prisma.decisionInteraction.findMany({
      where: openDecisionReviewWhere(WWMD_PLATFORM_PROFILE_ID),
      select: openDecisionReviewSelect,
    }),
    prisma.decisionInteraction.findMany({
      where: openDecisionReviewWhere({ in: wwwdProfileIds }),
      select: openDecisionReviewSelect,
    }),
    prisma.decisionInteraction.findMany({
      where: openDecisionReviewWhere({ startsWith: "wsid-" }),
      select: openDecisionReviewSelect,
    }),
    prisma.decisionInteraction.count({
      where: { profileId: WWMD_PLATFORM_PROFILE_ID, createdAt: { gte: decisionWindow } },
    }),
    prisma.decisionInteraction.count({
      where: { profileId: { in: wwwdProfileIds }, createdAt: { gte: decisionWindow } },
    }),
    prisma.decisionInteraction.count({
      where: { profileId: { startsWith: "wsid-" }, createdAt: { gte: decisionWindow } },
    }),
    prisma.decisionInteraction.findMany({
      where: openDecisionReviewWhere(),
      orderBy: { createdAt: "desc" },
      take: 8,
      select: openDecisionReviewSelect,
    }),
  ]);

  const wwmdOpenReviews = countUniqueOpenReviews(wwmdOpenReviewRows as DecisionInteractionQueueRow[]);
  const wwwdOpenReviews = countUniqueOpenReviews(wwwdOpenReviewRows as DecisionInteractionQueueRow[]);
  const wsidOpenReviews = countUniqueOpenReviews(wsidOpenReviewRows as DecisionInteractionQueueRow[]);
  const totalOpenReviews = wwmdOpenReviews + wwwdOpenReviews + wsidOpenReviews;
  const plural = (n: number) => `${n} open review${n === 1 ? "" : "s"}`;

  const reviewCandidates = (topOpenReviews as DecisionInteractionQueueRow[])
    .filter((row) => !isBlankFounderReviewQuestion(row))
    .filter((row) => isFounderActionable(row))
    .map((row) => projectFounderReviewCandidate(row));
  const reviewLines = dedupeFounderReviewCandidates(reviewCandidates)
    .map((c) => `- [${c.profileLabel}] "${c.question}" — ${c.unresolvedReasonLabel}; suggested action: ${c.primaryActionLabel}; open evidence at ${c.links.decisionCanvasHref}`);

  return [
    "\nPAGE DATA — Decision Governance (/coworker-decisions):",
    "This page is the decision-governance hub. Three disciplines govern every call your AI workforce makes: WWMD (What Would Mark Do — platform doctrine), WWWD (What Would We Do — this business's own stance), and WSID (What Should I Do — each role's craft). An \"open review\" is an unresolved decision (deferred or escalated) awaiting a human.",
    "",
    `OPEN REVIEWS awaiting a human: ${totalOpenReviews} total`,
    `- WWMD (platform): ${plural(wwmdOpenReviews)}`,
    `- WWWD (business): ${plural(wwwdOpenReviews)}`,
    `- WSID (craft): ${plural(wsidOpenReviews)}`,
    "",
    `DECISIONS RECORDED (last 30 days): WWMD ${wwmdDecisions30d}, WWWD ${wwwdDecisions30d}, WSID ${wsidDecisions30d}`,
    `GOVERNING MATERIAL: ${kernelPrincipleCount} kernel principles, ${kernelHeuristicCount} heuristics, ${wsidActiveProfiles} active role families.`,
    "",
    totalOpenReviews > 0
      ? "TOP OPEN REVIEWS (most recent unresolved — you can act on these, do NOT ask the user to paste them):"
      : "There are no open reviews right now.",
    ...reviewLines,
    "",
    "To act: call list_open_decision_reviews for the full queue with each item's unresolved reason and gap detail, read them, and recommend a resolution. The human reviews each Decision Canvas at /platform/ai/decisions/<interactionId> and records the outcome in the owning workflow; Founder Review is only a filtered residue lens, not the main action inbox.",
  ].join("\n");
}
