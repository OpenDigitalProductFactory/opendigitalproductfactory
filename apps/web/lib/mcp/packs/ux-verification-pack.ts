// apps/web/lib/mcp/packs/ux-verification-pack.ts
//
// BI-9369DEB5 — an agent verifying the UX of a fully automated installation
// asks the platform to sign its own browser in. The tool returns a one-time
// link for the seeded automation persona; the agent opens it in the browser
// it drives, lands on the requested page with a real session, and judges
// layout, type, colour and overrun the way a person would. No password is
// typed and no credential passes through the agent.

import type { ToolDefinition, ToolResult, ToolExecutionContext } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "issue_ux_verification_sign_in",
    description:
      "Sign a verification browser in through a one-time link, then inspect the requested page. Without fixture, use the shared automation persona under the installation's automation sign-in policy. With fixture, create or reuse an isolated ordinary user on development or test only, under your current permissions and workroom lease. Links last at most ten minutes; sessions last at most two hours, capped by fixture expiry. Use retireRunId to clean up your isolated run after its work settles.",
    inputSchema: {
      type: "object",
      properties: {
        nextPath: {
          type: "string",
          description: "Portal path to land on after sign-in, e.g. /platform/federation-links. Defaults to /.",
        },
        reason: {
          type: "string",
          description: "Short audit tag for why the session is needed.",
        },
        fixture: {
          type: "object", additionalProperties: false,
          description: "Optional isolated verification user. Start a run with capsuleId and leaseId, then reuse its returned runId. Roles and expiry are never restored by renewal.",
          properties: {
            runId: { type: "string" }, capsuleId: { type: "string" }, leaseId: { type: "string" },
            profile: { type: "string", enum: ["platform_manager", "developer", "backlog_manager", "employee", "developer_backlog_manager"] },
            slot: { type: "integer", minimum: 0, maximum: 1 },
          }, required: ["profile", "slot"],
        },
        retireRunId: { type: "string", description: "Retire your isolated verification run after its tasks and rooms are closed. Returns any still-pending work; does not claim cancellation has completed." },
      },
      required: [],
    },
    requiredCapability: "manage_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function issueUxVerificationSignInTool(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const { mintAutomationSignIn } = await import("@/lib/govern/automation-sign-in");
  const { resolveAppBaseUrl } = await import("@/lib/app-url");
  const reason = typeof params["reason"] === "string" ? params["reason"].trim().slice(0, 80) : "";
  const requestedBy = `mcp:${context?.agentId?.trim() || "agent"}${reason ? `:${reason}` : ""}`;
  const actor = { userId, agentId: context?.agentId ?? "", apiTokenId: context?.apiTokenId,
    authSource: context?.authSource, taskRunId: context?.taskRunId };
  if (params["retireRunId"] !== undefined) {
    if (typeof params["retireRunId"] !== "string" || !params["retireRunId"] || params["fixture"] !== undefined) {
      return { success: false, message: "Choose either sign-in or retirement for one verification run." };
    }
    const retired = await (await import("@/lib/govern/automation-fixture")).retireFixtureRun(params["retireRunId"], actor);
    return { success: retired.retired, message: retired.retired ? "The verification run is retired." : "Cleanup is pending. Cancel and settle the listed tasks and close the listed rooms, then retry retirement.", data: retired };
  }
  const fixture = params["fixture"] === undefined ? undefined
    : (await import("@/lib/govern/automation-fixture")).parseFixtureRequest(params["fixture"]);
  const result = await mintAutomationSignIn({
    nextPath: typeof params["nextPath"] === "string" ? params["nextPath"] : undefined,
    baseUrl: resolveAppBaseUrl() ?? "http://localhost:3000",
    requestedBy,
    fixture,
    actor,
  });
  if (!result.issued) {
    return { success: false, message: `Automation sign-in refused: ${result.reason}`, data: { reason: result.reason } };
  }
  return {
    success: true,
    message: `Open the returned sign-in link in the browser you drive. It works once until ${result.expiresAt}; the session lasts at most two hours and may end earlier with the verification lease.`,
    data: {
      url: result.url,
      path: result.path,
      expiresAt: result.expiresAt,
      persona: result.persona,
      permittedBecause: result.because,
      ...(result.runId ? { runId: result.runId } : {}),
    },
  };
}

export const uxVerificationPack: ToolPack = {
  packId: "ux-verification",
  definitions,
  handlers: {
    issue_ux_verification_sign_in: issueUxVerificationSignInTool,
  },
  grants: {
    // The same grant a development token already holds for running things in
    // the sandbox: verifying the UX is part of the same job, so no new grant
    // has to be issued before an agent can look at a page.
    issue_ux_verification_sign_in: ["sandbox_execute"],
  },
};
