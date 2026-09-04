// apps/web/lib/mcp/packs/ux-verification-pack.ts
//
// BI-9369DEB5 — an agent verifying the UX of a fully automated installation
// asks the platform to sign its own browser in. The tool returns a one-time
// link for the seeded automation persona; the agent opens it in the browser
// it drives, lands on the requested page with a real session, and judges
// layout, type, colour and overrun the way a person would. No password is
// typed and no credential passes through the agent.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "issue_ux_verification_sign_in",
    description:
      "Sign the platform's own browser in for UX verification. Returns a one-time link (valid ten minutes, usable once) that opens a two-hour session as the seeded automation persona and lands on nextPath. Open the link in the browser you drive, then inspect the page as a person would: layout, font sizes, colours, overruns, empty states. Permitted on development and test installations by default; a production installation refuses unless an operator recorded automation.signIn.enabled. Every action taken in that session is attributed to automation@dpf.local.",
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
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { mintAutomationSignIn } = await import("@/lib/govern/automation-sign-in");
  const { resolveAppBaseUrl } = await import("@/lib/app-url");
  const reason = typeof params["reason"] === "string" ? params["reason"].trim().slice(0, 80) : "";
  const requestedBy = `mcp:${context?.agentId?.trim() || "agent"}${reason ? `:${reason}` : ""}`;
  const result = await mintAutomationSignIn({
    nextPath: typeof params["nextPath"] === "string" ? params["nextPath"] : undefined,
    baseUrl: resolveAppBaseUrl() ?? "http://localhost:3000",
    requestedBy,
  });
  if (!result.issued) {
    return { success: false, message: `Automation sign-in refused: ${result.reason}`, data: { reason: result.reason } };
  }
  return {
    success: true,
    message: `Open ${result.url} in the browser you drive; the session lasts two hours and the link works once until ${result.expiresAt}.`,
    data: {
      url: result.url,
      path: result.path,
      expiresAt: result.expiresAt,
      persona: result.persona,
      permittedBecause: result.because,
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
