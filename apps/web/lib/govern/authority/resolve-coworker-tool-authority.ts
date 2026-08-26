import "server-only";

import { prisma } from "@dpf/db";
import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";

import { findApprovedAuthorityEnvelope } from "@/lib/coworker/authority-approval-envelope";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute";
import { getGrantedCapabilities } from "@/lib/permissions";

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

/** Resolve initiative subject and organization from the canonical item. Caller
 * organization fields are ignored; authenticated context can only narrow. */
export async function resolveInitiativeAuthorityContext(input: {
  params: Record<string, unknown>;
  authenticatedOrganizationId?: string | null;
  db: InitiativeAuthorityDb;
}): Promise<{
  subject: CoworkerAuthoritySubject;
  organizationId: string | null;
}> {
  const subject = deriveCoworkerAuthoritySubject(input.params);
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
  if (!input.authenticatedOrganizationId) {
    throw new Error("Backlog-item authority requires an authenticated organization context.");
  }
  if (
    input.authenticatedOrganizationId !== item.organizationId
  ) {
    throw new Error("The governed backlog item does not match the authenticated organization.");
  }
  return { subject, organizationId: item.organizationId };
}

export function deriveCoworkerApprovalPolicy(input: {
  hitlTierDefault: number;
  hitlPolicy: string | null;
}): CoworkerApprovalPolicy {
  const policy = input.hitlPolicy?.trim().toLowerCase() ?? "";
  if (input.hitlTierDefault <= 1 || policy === "always") return "all";
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

    const [agent, delegation, task, initiativeAuthority] = await Promise.all([
      db.agent.findFirst({
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
      }),
      execution.context?.delegationChainId
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
        : Promise.resolve(null),
      execution.context?.taskRunId
        ? db.taskRun.findUnique({
            where: { taskRunId: execution.context.taskRunId },
            select: { taskRunId: true, parentTaskRunId: true },
          })
        : Promise.resolve(null),
      resolveInitiativeAuthorityContext({
        params: execution.rawParams,
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
