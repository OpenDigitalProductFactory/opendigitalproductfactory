// Coworker collaboration tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the two multi-agent collaboration doors out of the mcp-tools.ts
// executeTool switch: request_coworker (hand off a scoped sub-task to a named
// peer) and summon_coworker (bring a named peer into the current conversation).
// General collaboration uses thread_write. Evidence authors can request only
// a current server-issued independent review through the token-bound task owner.
// Central TOOL_TO_GRANTS owns disclosure; the request guard narrows execution.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { dispatchExternalCoworkerTask } from "@/lib/mcp/external-coworker-task-adapter";
import { authorizeCoworkerRequest } from "@/lib/mcp/independent-review-request";

const originalReviewRecoveryProperty = {
  reviewRecovery: {
    type: "object", additionalProperties: false,
    description: "Original-task recovery target issued with the exact readiness packet. A locator grants no authority; stale or ineligible targets refuse without creating a new task.",
    properties: { taskRunId: { type: "string" }, requestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, expectedUpdatedAt: { type: "string" } },
    required: ["taskRunId", "requestDigest", "expectedUpdatedAt"],
  },
};

const initiativeReviewProperties = {
  requiredToolNames: {
    type: "array",
    items: { type: "string" },
    maxItems: 4,
    description: "Exact immutable reader and governed writer names from a server-issued initiative-readiness recovery packet.",
  },
  initiativeReviewBinding: {
    type: "object",
    properties: {
      writerToolName: { type: "string" },
      itemId: { type: "string" },
      gate: { type: "string" },
      expectedCurrentBaselineId: { type: ["string", "null"] },
      eligibleEvidenceActivityIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 500,
        uniqueItems: true,
        description:
          "Exact eligible post-baseline evidence activity IDs from an objective-mapping recovery packet. Required by the server when gate is objective-mapping.",
      },
      workroomRef: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["workroom-head"] },
          workroomId: { type: "string" },
          repositoryFullName: { type: "string" },
          branchName: { type: "string" },
          headSha: { type: "string" },
        },
        required: ["kind", "workroomId", "repositoryFullName", "branchName", "headSha"],
        additionalProperties: false,
      },
      artifactRef: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["repo-blob-at-commit"] },
          repositoryFullName: { type: "string" },
          commitSha: { type: "string" },
          path: { type: "string" },
          providerBlobId: { type: "string" },
        },
        required: ["kind", "repositoryFullName", "commitSha", "path", "providerBlobId"],
      },
    },
    required: ["writerToolName", "itemId", "gate", "artifactRef"],
    description: "Server-validated immutable initiative-review identity. Supply only with requiredToolNames from the same recovery packet.",
  },
} as const;

const definitions: ToolDefinition[] = [
  {
    name: "get_my_approval_status",
    description: "Read an exact approval outcome by envelopeId and separately report safe stored action evidence for provider-account tests, or explicit missing, conflicting or unsupported evidence. Generic test success does not prove Responses verification or quota reconciliation. Mode pending lists up to 20 unexpired requests FROM THIS ASSISTANT ONLY for the authenticated user, with owner, expiry, Inbox link and immutable review locator; hasMore names a bounded page. This is NOT the owner's whole Inbox: other coworkers' requests are excluded and ownerInboxTotal is unknown. Zero here never establishes that the user's Inbox is empty. Does not execute, approve, retry, transfer ownership or grant access.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: ["exact", "pending"], description: "Defaults to exact; pending omits envelopeId." },
      envelopeId: { type: "string", minLength: 1, maxLength: 128 },
    }, additionalProperties: false },
    requiredCapability: null,
    sideEffect: false,
    executionMode: "immediate",
  },
  {
    name: "probe_pending_approval_conversion",
    title: "Probe pending approval conversion",
    description: "Dry-run, for every pending proposal, what converting it to an approval request would hit: the authority decision, identity resolution, governance hook verdicts and alignment requirement, with one refusal code per row and the owner's activity. Read-only: runs no tool, approves nothing and writes nothing. Platform administrators only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredCapability: "manage_platform",
    // Read-only by construction: evaluation runs on read-only transactions and no handler is called.
    sideEffect: false,
    executionMode: "immediate",
  },
  {
    name: "request_coworker",
    description:
      "Hand off a scoped sub-task to a NAMED peer coworker. Unlike spawn_work_thread (anonymous child), this targets a specific coworker by agentId or slug and emits a VISIBLE handoff the user sees inline. Use when you need another coworker's distinct capability (e.g. ask the Enterprise Architect to review a schema).",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias (e.g. 'ea-architect')." },
        objective: { type: "string", description: "The scoped sub-task for the peer coworker." },
        questionPacketSummary: { type: "string", description: "Optional one-line summary of the intent/question shown on the handoff card." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2). Tier 3 requires depth-2 spawn support." },
        enteredVia: { type: "string", enum: ["handoff", "escalation", "spawn"], description: "How the peer is entering (default 'handoff')." },
        requestKey: { type: "string", description: "Stable idempotency key required for threadless external MCP handoffs." },
        ...initiativeReviewProperties,
        ...originalReviewRecoveryProperty,
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Delegation is advise-safe coordination — an advisor may route a scoped
    // sub-task to a named peer with a visible handoff without leaving advise
    // mode. Kept sideEffect:true for annotations; adviseCoordination exempts it
    // from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
  {
    name: "summon_coworker",
    description:
      "Bring a NAMED coworker into the current conversation as a second/third-tier participant to address part of the work, emitting a VISIBLE summon the user sees inline. YOU (the active coworker) decide which peer to bring in and what to task them with — this is your responsibility, not the user's. Use when a request needs a peer's distinct capability alongside you in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: { type: "string", description: "Target coworker — canonical agentId (AGT-*) or slug alias." },
        objective: { type: "string", description: "What the summoned coworker should address." },
        tier: { type: "number", enum: [2, 3], description: "Interaction tier (default 2)." },
        requestKey: { type: "string", description: "Stable idempotency key required for threadless external MCP summons." },
        ...initiativeReviewProperties,
      },
      required: ["targetAgent", "objective"],
    },
    requiredCapability: null,
    sideEffect: true,
    // Bringing a named peer into the conversation is advise-safe coordination —
    // the advisor decides which teammate to pull in; the handoff is visible and
    // reversible. Kept sideEffect:true for annotations; adviseCoordination
    // exempts it from the advise-mode runtime filter (BI-7EB4AE2C).
    adviseCoordination: true,
  },
  {
    name: "find_coworker",
    description:
      "Discover which coworker to hand a task to, by intent. request_coworker and summon_coworker need an exact agentId or slug; call this first with {query} describing the capability you need (e.g. \"review a database schema\", \"marketing campaign\") to get the matching coworkers' ids, names, and what they do. Read-only discovery — it does not contact anyone. Then pass the chosen agentId to request_coworker or summon_coworker.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive intent/capability keywords matched against coworker name, role, description, and skills.",
        },
        limit: { type: "number", description: "Max matches to return (default 8, max 25)." },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

/** BI-4592CF69: the author learns at request time what the reviewer would hit. */
function withReviewDocumentNotice(result: ToolResult, notice: string | undefined): ToolResult {
  if (!notice || !result.success) return result;
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : {};
  return { ...result, message: [result.message, notice].filter(Boolean).join(" "), data: { ...data, reviewDocumentNotice: notice } };
}

async function requestCoworkerHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const targetAgent = String(params["targetAgent"] ?? "").trim();
  const objective = String(params["objective"] ?? "").trim();
  if (!targetAgent || !objective) {
    return { success: false, error: "invalid_params", message: "request_coworker requires targetAgent and objective." };
  }
  const authority = await authorizeCoworkerRequest(params, userId, context);
  if (authority.refusal) return authority.refusal;
  if (authority.bounded || !context?.threadId) {
    const dispatched = await dispatchExternalCoworkerTask({
      collaborationKind: "handoff",
      targetAgent,
      objective,
      requestKey: typeof params["requestKey"] === "string" ? params["requestKey"] : undefined,
      title: typeof params["questionPacketSummary"] === "string" ? params["questionPacketSummary"] : undefined,
      requiredToolNames: params["requiredToolNames"],
      initiativeReviewBinding: params["initiativeReviewBinding"],
      reviewRecovery: params["reviewRecovery"],
      userId,
      context: authority.bounded ? { ...context, routeContext: "/build" } : context,
    });
    return withReviewDocumentNotice(dispatched, authority.notice);
  }
  const tierParam = Number(params["tier"]);
  const enteredViaParam = typeof params["enteredVia"] === "string" ? params["enteredVia"] : undefined;
  const { requestCoworker } = await import("@/lib/tak/coworker-collaboration");
  try {
    const result = await requestCoworker(
      {
        parentThreadId: context.threadId,
        targetAgent,
        objective,
        tier: tierParam === 3 ? 3 : 2,
        enteredVia: enteredViaParam === "escalation" || enteredViaParam === "spawn" ? enteredViaParam : "handoff",
        callerAgentId: context.agentId ?? null,
        questionPacketSummary: typeof params["questionPacketSummary"] === "string" ? params["questionPacketSummary"] : undefined,
        routeContext: context.routeContext,
        runtimeMode: context.coworkerMode,
      },
      userId,
    );
    return {
      success: true,
      entityId: result.childThreadId,
      message: `Handed off to ${result.targetLabel}.`,
      data: result,
    };
  } catch (err) {
    return { success: false, error: "handoff_failed", message: err instanceof Error ? err.message : "request_coworker failed." };
  }
}

async function summonCoworkerHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const targetAgent = String(params["targetAgent"] ?? "").trim();
  const objective = String(params["objective"] ?? "").trim();
  if (!targetAgent || !objective) {
    return { success: false, error: "invalid_params", message: "summon_coworker requires targetAgent and objective." };
  }
  if (!context?.threadId) {
    return dispatchExternalCoworkerTask({
      collaborationKind: "summon",
      targetAgent,
      objective,
      requestKey: typeof params["requestKey"] === "string" ? params["requestKey"] : undefined,
      requiredToolNames: params["requiredToolNames"],
      initiativeReviewBinding: params["initiativeReviewBinding"],
      reviewRecovery: params["reviewRecovery"],
      userId,
      context,
    });
  }
  const tierParam = Number(params["tier"]);
  const { summonCoworker } = await import("@/lib/tak/coworker-collaboration");
  try {
    const result = await summonCoworker(
      {
        parentThreadId: context.threadId,
        targetAgent,
        objective,
        tier: tierParam === 3 ? 3 : 2,
        callerAgentId: context.agentId ?? null,
        routeContext: context.routeContext,
        runtimeMode: context.coworkerMode,
      },
      userId,
    );
    return {
      success: true,
      entityId: result.childThreadId,
      message: `Summoned ${result.targetLabel}.`,
      data: result,
    };
  } catch (err) {
    return { success: false, error: "summon_failed", message: err instanceof Error ? err.message : "summon_coworker failed." };
  }
}

export type CoworkerRosterEntry = {
  agentId: string;
  slugId: string | null;
  displayName: string;
  description: string | null;
  role: string | null;
  kind: string;
  skills: string[];
};

export type CoworkerMatch = {
  agentId: string;
  slugId: string | null;
  displayName: string;
  description: string | null;
  matchedOn: string[];
};

// Pure intent matcher: score each coworker by how many query terms hit its
// name/role/kind/description/skills (name and role weighted higher); return the
// top `limit`, best first. Ties break alphabetically for a stable order.
export function matchCoworkers(
  roster: CoworkerRosterEntry[],
  query: string,
  limit: number,
): CoworkerMatch[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  return roster
    .map((c) => {
      const fields: Array<[string, string, number]> = [
        ["name", c.displayName.toLowerCase(), 2],
        ["role", (c.role ?? "").toLowerCase(), 2],
        ["kind", c.kind.toLowerCase(), 1],
        ["description", (c.description ?? "").toLowerCase(), 1],
        ["skills", c.skills.join(" ").toLowerCase(), 1],
      ];
      const matchedOn = new Set<string>();
      let score = 0;
      for (const term of terms) {
        for (const [field, hay, weight] of fields) {
          if (hay.includes(term)) {
            score += weight;
            matchedOn.add(field);
          }
        }
      }
      return { c, score, matchedOn: [...matchedOn] };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.c.displayName.localeCompare(b.c.displayName))
    .slice(0, limit)
    .map(({ c, matchedOn }) => ({
      agentId: c.agentId,
      slugId: c.slugId,
      displayName: c.displayName,
      description: c.description,
      matchedOn,
    }));
}

async function findCoworkerHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const query = String(params["query"] ?? "").trim();
  if (!query) {
    return { success: false, error: "invalid_params", message: "find_coworker requires a query." };
  }
  const limit = Math.min(Math.max(Number(params["limit"]) || 8, 1), 25);
  const { prisma } = await import("@dpf/db");
  const rows = await prisma.agent.findMany({
    where: { status: "active", archived: false, lifecycleStage: "production" },
    select: {
      agentId: true,
      slugId: true,
      displayName: true,
      description: true,
      role: true,
      kind: true,
      skills: { select: { label: true } },
    },
  });
  const roster: CoworkerRosterEntry[] = rows.map((r) => ({
    agentId: r.agentId,
    slugId: r.slugId,
    displayName: r.displayName,
    description: r.description,
    role: r.role,
    kind: r.kind,
    skills: r.skills.map((s) => s.label),
  }));
  const matches = matchCoworkers(roster, query, limit);
  return {
    success: true,
    message: matches.length
      ? `Found ${matches.length} coworker(s) for "${query}". Pass an agentId to request_coworker or summon_coworker.`
      : `No coworker matched "${query}". Try broader capability keywords.`,
    data: { matches, count: matches.length },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_my_approval_status: async (params, userId, context) => {
    if (params.mode !== undefined && params.mode !== "exact" && params.mode !== "pending") {
      return { success: false, error: "invalid_params", message: "Choose exact or pending approval lookup." };
    }
    if (params.mode === "pending") {
      if (Object.hasOwn(params, "envelopeId")) return { success: false, error: "invalid_params", message: "Pending discovery must omit envelopeId." };
      if (!userId || !context?.agentId) return { success: false, error: "approval_identity_required", message: "Approval discovery requires an authenticated user and assistant." };
      const { listPendingApprovalOutcomes } = await import("@/lib/coworker/approval-outcome-store");
      const data = await listPendingApprovalOutcomes(userId, context.agentId);
      const page = data.hasMore
        ? "Showing 20 pending requests from this assistant only; more requests from this assistant remain."
        : `Found ${data.approvals.length} pending approval request(s) from this assistant only.`;
      const emptyWarning = data.approvals.length === 0
        ? " This does not mean the owner's Inbox is empty." : "";
      return { success: true,
        message: `${page}${emptyWarning} The owner's Inbox total is unknown: this lookup excludes requests from other coworkers. Open the Inbox to review all requests you can access.`,
        data: { ...data, ownerInboxTotal: null, scope: {
          kind: "current-assistant-requests", delegatingUserId: userId,
          coworkerAgentId: context.agentId, coversOwnerInbox: false,
        } },
      };
    }
    const envelopeId = typeof params.envelopeId === "string" ? params.envelopeId.trim() : "";
    if (!envelopeId || envelopeId.length > 128) return { success: false, error: "invalid_params", message: "An approval request ID is required." };
    const { readApprovalOutcome } = await import("@/lib/coworker/approval-outcome-store");
    const outcome = await readApprovalOutcome(envelopeId, userId, context?.agentId);
    if (!outcome) return { success: false, error: "approval_not_available", message: "This approval request is not available to your current user and assistant." };
    return { success: true, message: `${outcome.label}. ${outcome.nextAction}`, data: outcome };
  },
  probe_pending_approval_conversion: async (params, userId) => {
    if (Object.keys(params).length) return { success: false, error: "invalid_params", message: "This probe takes no inputs; it reads every pending proposal." };
    const [{ currentUserContext }, { can }] = await Promise.all([
      import("@/lib/govern/current-user-context"), import("@/lib/govern/permissions"),
    ]);
    const user = await currentUserContext(userId);
    if (!user || !can(user, "manage_platform")) return { success: false, error: "forbidden", message: "Platform administration permission is required." };
    const [{ prisma }, { runApprovalConvergenceProbe }] = await Promise.all([
      import("@dpf/db"), import("@/lib/coworker/approval-convergence-probe-run"),
    ]);
    const report = await runApprovalConvergenceProbe(prisma);
    return { success: true, message: `Probed ${report.summary.rows} pending proposal(s) at ${report.probedAt}.`, data: report };
  },
  request_coworker: (params, userId, context) => requestCoworkerHandler(params, userId, context),
  summon_coworker: (params, userId, context) => summonCoworkerHandler(params, userId, context),
  find_coworker: (params) => findCoworkerHandler(params),
};

export const coworkerPack: ToolPack = {
  packId: "coworker",
  definitions,
  handlers,
  grants: {},
};
