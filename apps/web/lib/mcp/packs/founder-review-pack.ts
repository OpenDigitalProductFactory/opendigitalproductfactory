// Founder / decision-review reads (BI-3786CF82, EP-0AF96937 review-and-adjust loop).
//
// The /coworker-decisions Decision Governance hub shows counts of "open reviews" — unresolved
// DecisionInteraction rows (outcomeType defer/escalate) awaiting a human — but no
// coworker-callable tool surfaced them, so a coworker asked "what should we do
// about these open reviews?" had nothing to read and told the user to paste the
// screen. This pack exposes the same filtered "open review" residue that the
// Founder Review workspace renders
// (apps/web/lib/founder-review/queue.ts + apps/web/app/(shell)/platform/ai/
// founder-review/page.tsx) as a read tool, so the coworker can name each review,
// its unresolved reason and gap detail, and recommend a resolution.
//
// Read-only by design. Resolving a deferred/escalated decision is a human action
// (Human-in-the-Loop at Phase Boundaries) taken in the owning workflow after the
// human reviews the Decision Canvas evidence; a coworker recommends, the human
// confirms. The gating grant is
// `registry_read` (a coworker-read baseline), so every coworker inherits it — the
// pack mirrors agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const DISCIPLINES = ["all", "wwmd", "wwwd", "wsid"] as const;
const UNRESOLVED_OUTCOMES = ["defer", "escalate"];

/** Bound free-text fields so a large queue can't blow the local model window
 *  (the MCP route also caps the whole result — this keeps per-item cost small). */
function truncate(value: string | null, max = 400): string | null {
  if (value === null) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const definitions: ToolDefinition[] = [
  {
    name: "list_open_decision_reviews",
    description:
      "List the OPEN DECISION REVIEWS shown on the /coworker-decisions Decision Governance hub — decisions your AI workforce deferred or escalated to a human and that are still unresolved. Returns each review's question, discipline (WWMD platform / WWWD business / WSID craft), why it is unresolved, the gap detail, a suggested next action, and a decision-canvas link. Use this to answer 'what should we do about these open reviews?' by reading and recommending on the actual queue instead of asking the user to paste the screen. Read-only: resolving a review is a human action taken in the owning workflow after reviewing the Decision Canvas evidence; this tool lets you understand and recommend.",
    inputSchema: {
      type: "object",
      properties: {
        discipline: {
          type: "string",
          enum: [...DISCIPLINES],
          description:
            "Which discipline's reviews to list: 'wwmd' (platform doctrine), 'wwwd' (this business's stance), 'wsid' (role craft), or 'all' (default).",
        },
        limit: {
          type: "number",
          description: "Maximum reviews to return (default 20, max 50), most recent first.",
        },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function listOpenDecisionReviews(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { Prisma, prisma } = await import("@dpf/db");
  const {
    dedupeFounderReviewCandidates,
    isFounderActionable,
    isBlankFounderReviewQuestion,
    projectFounderReviewCandidate,
  } = await import("@/lib/founder-review/queue");
  const { WWMD_PLATFORM_PROFILE_ID, WWWD_ORGANIZATION_PROFILE_ID } = await import(
    "@/lib/decision/caller-context"
  );
  const { resolveOrgProfileId } = await import("@/lib/decision-perspective/material");

  const disciplineRaw = String(params["discipline"] ?? "all").toLowerCase();
  const discipline = (DISCIPLINES as readonly string[]).includes(disciplineRaw)
    ? (disciplineRaw as (typeof DISCIPLINES)[number])
    : "all";

  const rawLimit = Number(params["limit"] ?? 20);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 20;

  // Scope by discipline, mirroring the /coworker-decisions hub counts. WWWD reads off the org's
  // OWN profile (seeded at onboarding) plus the platform fallback id.
  let profileFilter: string | { startsWith: string } | { in: string[] } | undefined;
  if (discipline === "wwmd") {
    profileFilter = WWMD_PLATFORM_PROFILE_ID;
  } else if (discipline === "wsid") {
    profileFilter = { startsWith: "wsid-" };
  } else if (discipline === "wwwd") {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    const orgProfileId = org ? await resolveOrgProfileId({ db: prisma, organizationId: org.id }) : null;
    profileFilter = {
      in: orgProfileId ? [orgProfileId, WWWD_ORGANIZATION_PROFILE_ID] : [WWWD_ORGANIZATION_PROFILE_ID],
    };
  }

  const rows = await prisma.decisionInteraction.findMany({
    where: {
      outcomeType: { in: UNRESOLVED_OUTCOMES },
      humanOutcome: { equals: Prisma.DbNull },
      question: { not: "" },
      // Mirror of isFounderActionable at the DB, so `take: limit` counts only
      // rows a human should decide, not advisory/agent-internal noise the JS
      // filter would drop afterward (BI-6EC1EE25). The JS filter below stays the
      // authoritative predicate; this keeps the limit meaningful.
      NOT: [
        // Advisory by contract — the profession/WSID gate blocks nothing.
        { gateKey: "profession" },
        // Already-executed agent-internal kernel consults (BI-9026B96C).
        {
          buildId: null,
          taskRunId: null,
          OR: [
            { routeContext: { startsWith: "mcp:principle_decide" } },
            { domainClass: "kernel-consult" },
          ],
        },
      ],
      ...(profileFilter !== undefined ? { profileId: profileFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
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
      deferralCapture: { select: { gapReason: true, domain: true, suggestedSourceTypes: true } },
      escalationCapture: { select: { prompt: true } },
    },
  });

  const candidates = rows
    .filter((row) => !isBlankFounderReviewQuestion(row))
    .filter((row) => isFounderActionable(row))
    .map((row) => ({ row, candidate: projectFounderReviewCandidate(row) }));
  const uniqueIds = new Set(
    dedupeFounderReviewCandidates(candidates.map((item) => item.candidate)).map((candidate) => candidate.id),
  );
  const reviews = candidates
    .filter((item) => uniqueIds.has(item.candidate.id))
    .map((row) => {
      const candidate = row.candidate;
      const gapDetail = row.row.deferralCapture?.gapReason ?? row.row.escalationCapture?.prompt ?? null;
      return {
        interactionId: candidate.id,
        question: truncate(candidate.question),
        discipline: candidate.perspective, // "wwmd" | "wwwd" | null
        profileLabel: candidate.profileLabel,
        outcomeType: row.row.outcomeType,
        unresolvedReason: candidate.unresolvedReasonLabel,
        gapDetail: truncate(gapDetail),
        suggestedAction: candidate.primaryActionLabel,
        options: candidate.options,
        suggestedSourceTypes: row.row.deferralCapture?.suggestedSourceTypes ?? [],
        decisionCanvasHref: candidate.links.decisionCanvasHref,
        createdAt: candidate.createdAt,
      };
    });

  const scopeLabel = discipline === "all" ? "" : ` in ${discipline.toUpperCase()}`;
  return {
    success: true,
    message: reviews.length
      ? `${reviews.length} open decision review${reviews.length === 1 ? "" : "s"} awaiting a human${scopeLabel}. Read each one's gap detail and suggested action, then recommend a resolution — the human confirms it in the owning workflow after reviewing the Decision Canvas evidence.`
      : `No open decision reviews${scopeLabel}.`,
    data: { count: reviews.length, discipline, reviews },
  };
}

export const founderReviewPack: ToolPack = {
  packId: "founder-review",
  definitions,
  handlers: {
    list_open_decision_reviews: (params) => listOpenDecisionReviews(params),
  },
  grants: {
    list_open_decision_reviews: ["registry_read"],
  },
};
