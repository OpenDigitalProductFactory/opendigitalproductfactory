import "server-only";

import { prisma } from "@dpf/db";
import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";

import { findApprovedAuthorityEnvelope } from "@/lib/coworker/authority-approval-envelope";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute";
import { getGrantedCapabilities } from "@/lib/permissions";
import {
  parseInitiativeReviewBinding,
  validateInitiativeReviewAuthorityScope,
} from "@/lib/mcp-task-review-contract";

import {
  buildCoworkerApprovalBinding,
  type CoworkerAuthorityInput,
  type CoworkerApprovalPolicy,
  type CoworkerAuthoritySubject,
} from "./coworker-authority-decision";
import type { CoworkerAuthorityInputResolver } from "./coworker-tool-authority-gate";

type AuthorityDb = {
  backlogItem: {
    findUnique(args: unknown): Promise<{
      itemId: string;
      organizationId: string | null;
    } | null>;
  };
  agent: {
    findFirst(args: unknown): Promise<{
      id: string;
      agentId: string;
      sensitivity: string;
      hitlTierDefault: number;
      governanceProfile: {
        hitlPolicy: string;
        updatedAt: Date;
      } | null;
    } | null>;
  };
  delegationChain: {
    findFirst(args: unknown): Promise<{
      chainId: string;
      status: string;
      originUserId: string;
      toAgentId: string;
      authorityScope: string[];
    } | null>;
  };
  taskRun: {
    findUnique(args: unknown): Promise<{
      taskRunId: string;
      parentTaskRunId: string | null;
      authorityScope: unknown;
      a2aMetadata: unknown;
    } | null>;
  };
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function deriveCoworkerAuthoritySubject(
  params: Record<string, unknown>,
): CoworkerAuthoritySubject {
  const candidates: Array<
    [keyof Record<string, unknown>, CoworkerAuthoritySubject["kind"]]
  > = [
    ["itemId", "backlog-item"],
    ["employeeId", "employee"],
    ["accountId", "account"],
    ["contactId", "contact"],
    ["partnerAccountId", "partner-account"],
    ["principalId", "principal"],
    ["teamId", "team"],
  ];
  for (const [key, kind] of candidates) {
    const id = asString(params[key]);
    if (id) return { kind, id };
  }
  return { kind: "platform", id: "dpf" };
}

type InitiativeAuthorityDb = Pick<AuthorityDb, "backlogItem">;

type InitiativeReviewTask = {
  taskRunId: string;
  parentTaskRunId: string | null;
  authorityScope: unknown;
  a2aMetadata: unknown;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Return the server-bound initiative only for a fully validated external MCP
 * review. Once binding metadata is present, every mismatch fails closed rather
 * than falling back to model-visible writer arguments. */
export function resolveBoundInitiativeReviewItem(
  task: InitiativeReviewTask | null,
  executingToolName: string,
): string | null {
  if (!task) return null;
  const metadata = objectRecord(task.a2aMetadata);
  // `== null` catches BOTH an absent key and a persisted JSON null. It used to
  // be `=== undefined`, which a JSON null slips past: summon_coworker stores the
  // key unconditionally, so an ORDINARY dispatch with no review binding at all
  // arrived here as `null`, fell through to parseInitiativeReviewBinding(null),
  // and threw "invalid immutable initiative review binding". The gate then
  // rejected every governed tool on that task with "verified authority context
  // is unavailable".
  //
  // Observed 2026-09-06: the Compliance Officer was dispatched to research a
  // statutory rate, loaded its tools successfully, and had search_public_web
  // rejected twice. Nothing about that task involved an initiative review. This
  // failed closed on the absence of a thing that was never required, which is
  // the one direction a fail-closed check must not fire in.
  if (!metadata || metadata["initiativeReviewBinding"] == null) return null;
  const sourceRef = objectRecord(metadata["sourceRef"]);
  if (
    metadata["trigger"] !== "external-mcp"
    || (sourceRef?.["kind"] !== "mcp-token" && sourceRef?.["kind"] !== "mcp-session")
  ) {
    throw new Error("Initiative review authority requires an external MCP TaskRun.");
  }
  const binding = parseInitiativeReviewBinding(metadata["initiativeReviewBinding"]);
  if (!binding) {
    throw new Error("The external TaskRun has an invalid immutable initiative review binding.");
  }
  if (binding.writerToolName !== executingToolName) {
    if (
      executingToolName === "read_source_at_version"
      || executingToolName === "search_source_at_version"
    ) return null;
    throw new Error("The immutable initiative review writer tool does not match the executing tool.");
  }
  const authorityScope = Array.isArray(task.authorityScope)
    ? task.authorityScope.filter((entry): entry is string => typeof entry === "string")
    : [];
  const scopeError = validateInitiativeReviewAuthorityScope(binding, authorityScope);
  if (scopeError) {
    const required = authorityScope.includes(`tool:${binding.writerToolName}`)
      ? `backlog-item:${binding.itemId}`
      : `tool:${binding.writerToolName}`;
    throw new Error(`The external TaskRun is missing exact authority scope ${required}.`);
  }
  return binding.itemId;
}

/** Resolve initiative subject and organization from the canonical item. Caller
 * organization fields are ignored; authenticated context can only narrow. */
export async function resolveInitiativeAuthorityContext(input: {
  params: Record<string, unknown>;
  trustedBoundItemId?: string | null;
  authenticatedOrganizationId?: string | null;
  db: InitiativeAuthorityDb;
}): Promise<{
  subject: CoworkerAuthoritySubject;
  organizationId: string | null;
}> {
  const subject: CoworkerAuthoritySubject = input.trustedBoundItemId
    ? { kind: "backlog-item", id: input.trustedBoundItemId }
    : deriveCoworkerAuthoritySubject(input.params);
  if (subject.kind !== "backlog-item") {
    return {
      subject,
      organizationId: input.authenticatedOrganizationId ?? null,
    };
  }
  const item = await input.db.backlogItem.findUnique({
    where: { itemId: subject.id },
    select: { itemId: true, organizationId: true },
  });
  if (!item) throw new Error("The governed backlog item does not exist.");
  if (!item.organizationId) {
    return { subject, organizationId: "platform" };
  }
  if (!input.authenticatedOrganizationId && !input.trustedBoundItemId) {
    throw new Error("Backlog-item authority requires an authenticated organization context.");
  }
  if (
    input.authenticatedOrganizationId
    && input.authenticatedOrganizationId !== item.organizationId
  ) {
    throw new Error("The governed backlog item does not match the authenticated organization.");
  }
  return { subject, organizationId: item.organizationId };
}

export function deriveCoworkerApprovalPolicy(input: {
  hitlTierDefault: number;
  hitlPolicy: string | null;
  serverBoundInitiativeReview?: boolean;
}): CoworkerApprovalPolicy {
  const policy = input.hitlPolicy?.trim().toLowerCase() ?? "";
  // A server-issued initiative-review TaskRun is already constrained to one
  // immutable artifact, one backlog item, one exact writer, and an eligible
  // reviewer principal. Requiring the delegating employee to approve that
  // writer again turns the technical review into a human proxy gate and makes
  // the single-human installation path impossible to complete. Independence,
  // when required by the lane, remains enforced by the receipt repository.
  // `always` is an explicit operator policy and still wins. A numeric tier is
  // only the coworker's generic default, so it must not re-wrap this already
  // authorized initiative-review boundary in a second human approval.
  if (policy === "always") return "all";
  if (input.serverBoundInitiativeReview) return "none";
  if (input.hitlTierDefault <= 1) return "all";
  if (
    input.hitlTierDefault === 2
    || policy === "proposal_for_external_writes"
    || policy === "side-effects"
  ) {
    return "side-effects";
  }
  return "none";
}

export function deriveAllowedRouteContexts(
  screenSurface: string | undefined,
): readonly string[] | undefined {
  const surface = screenSurface?.trim();
  return surface && surface !== "*" ? [surface] : undefined;
}

function authSource(
  context: GovernedExecuteContext | undefined,
): "bearer" | "session" | "service" | "delegation" | "unknown" {
  if (context?.delegationChainId) return "delegation";
  if (context?.authSource === "pat") return "bearer";
  if (context?.authSource === "session-jwt") return "session";
  return "unknown";
}

/**
 * Resolve the server-owned inputs for the pure authority evaluator. Model
 * output and caller-provided policy claims never enter this function.
 */
export const resolveCoworkerToolAuthorityInput: CoworkerAuthorityInputResolver =
  async ({ execution, tool, agentGrantAllowed }, db: AuthorityDb = prisma as unknown as AuthorityDb) => {
    const actingAgentId = execution.context?.agentId;
    if (!actingAgentId) {
      throw new Error("Coworker authority resolution requires an agent identity.");
    }

    const agentPromise = db.agent.findFirst({
        where: {
          OR: [
            { id: actingAgentId },
            { agentId: actingAgentId },
            { slugId: actingAgentId },
          ],
          status: "active",
          archived: false,
        },
        select: {
          id: true,
          agentId: true,
          sensitivity: true,
          hitlTierDefault: true,
          governanceProfile: {
            select: { hitlPolicy: true, updatedAt: true },
          },
        },
      });
    const delegationPromise = execution.context?.delegationChainId
        ? db.delegationChain.findFirst({
            where: { chainId: execution.context.delegationChainId },
            orderBy: { depth: "desc" },
            select: {
              chainId: true,
              status: true,
              originUserId: true,
              toAgentId: true,
              authorityScope: true,
            },
          })
        : Promise.resolve(null);
    const task = execution.context?.taskRunId
        ? await db.taskRun.findUnique({
            where: { taskRunId: execution.context.taskRunId },
            select: {
              taskRunId: true,
              parentTaskRunId: true,
              authorityScope: true,
              a2aMetadata: true,
            },
          })
        : null;
    const trustedBoundItemId = resolveBoundInitiativeReviewItem(
      task,
      execution.toolName,
    );
    const [agent, delegation, initiativeAuthority] = await Promise.all([
      agentPromise,
      delegationPromise,
      resolveInitiativeAuthorityContext({
        params: execution.rawParams,
        trustedBoundItemId,
        authenticatedOrganizationId: execution.context?.organizationId,
        db,
      }),
    ]);
    if (!agent) {
      throw new Error("The executing coworker identity is not active.");
    }

    const grantedCapabilities = getGrantedCapabilities(execution.userContext);
    const effectiveAuth = await loadEffectiveAuthContext(
      {
        user: {
          id: execution.userId,
          email: "",
          type: "admin",
          platformRole: execution.userContext.platformRole,
          isSuperuser: execution.userContext.isSuperuser,
          accountId: null,
          accountName: null,
          contactId: null,
        },
        grantedCapabilities,
        authentication: {
          source: authSource(execution.context),
          methods: [],
        },
        actingAgentId: agent.agentId,
      },
      db as never,
    );

    const approvalPolicy = deriveCoworkerApprovalPolicy({
      hitlTierDefault: agent.hitlTierDefault,
      hitlPolicy: agent.governanceProfile?.hitlPolicy ?? null,
      serverBoundInitiativeReview: Boolean(trustedBoundItemId),
    });
    const sensitivity = coerceDataSensitivity(agent.sensitivity);
    const decisionVersionIds = [
      "coworker-authority-v1",
      agent.governanceProfile?.updatedAt.toISOString(),
    ].filter((value): value is string => Boolean(value));

    const input: CoworkerAuthorityInput = {
      authContext: effectiveAuth,
      organizationId: initiativeAuthority.organizationId,
      action: {
        toolName: execution.toolName,
        requiredCapability: tool.requiredCapability,
        agentGrantAllowed,
        sideEffect: tool.sideEffect === true,
        executionMode: tool.executionMode ?? "immediate",
        routeContext: execution.context?.routeContext ?? null,
        allowedRouteContexts: deriveAllowedRouteContexts(tool.screenSurface),
        approvalPolicy,
        requiresDelegationChain: Boolean(execution.context?.delegationChainId),
      },
      subject: initiativeAuthority.subject,
      delegation: delegation
        ? {
            chainId: delegation.chainId,
            status: delegation.status,
            originUserId: delegation.originUserId,
            currentAgentId: delegation.toAgentId,
            authorityScope: delegation.authorityScope,
          }
        : null,
      integration: {
        required: tool.requiresExternalAccess === true,
        state: tool.requiresExternalAccess
          ? execution.context?.externalAccessEnabled === true
            ? "connected"
            : "unknown"
          : "not-required",
      },
      dataPolicy: {
        sensitivity,
        maskingRequired: false,
        maskingSatisfied: true,
        decisionVersionsCurrent: true,
        decisionVersionIds,
      },
      task,
      rawParams: execution.rawParams,
      approval: null,
    };
    const binding = buildCoworkerApprovalBinding(input);
    const approval = await findApprovedAuthorityEnvelope(
      binding,
      new Date(),
      db as never,
    );
    return {
      ...input,
      approval,
    };
  };
