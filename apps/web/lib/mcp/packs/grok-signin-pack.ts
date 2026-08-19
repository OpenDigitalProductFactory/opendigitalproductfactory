// Grok sign-in tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the Grok (xAI) device-code OAuth sign-in domain out of the mcp-tools.ts
// executeTool switch: starting the device-code login for the build sandbox and
// polling for its completion. Each handler lazy-imports the single backing
// grok-device-login-core service and reproduces the former switch case verbatim,
// so behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "grok_signin_start",
    description: "Begin Grok (xAI) device-code OAuth sign-in for the build sandbox — the 'sign in with Google' alternative to an xAI API key. Runs `grok login --device-auth` in the sandbox and returns a verification URL + user code. Relay these to a human to authorize in their browser (Google / X / Apple), then call grok_signin_status to detect completion.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "grok_signin_status",
    description: "Check whether the Grok device-code sign-in started by grok_signin_start has been authorized. Returns status 'ok' (credential captured + xAI provider activated), 'pending' (still waiting for the human to authorize), or 'failed'.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
];

async function grokSigninStartHandler(): Promise<ToolResult> {
  const { grokDeviceLoginStart } = await import("@/lib/build/grok-device-login-core");
  const result = await grokDeviceLoginStart();
  if ("error" in result) {
    return { success: false, error: "device_login_failed", message: result.error };
  }
  return {
    success: true,
    message: `Grok sign-in started. Ask the operator to open ${result.verificationUrl}${result.userCode ? ` and confirm the code ${result.userCode}` : ""}, then call grok_signin_status to detect completion.`,
    data: { verificationUrl: result.verificationUrl, userCode: result.userCode },
  };
}

async function grokSigninStatusHandler(): Promise<ToolResult> {
  const { grokDeviceLoginComplete } = await import("@/lib/build/grok-device-login-core");
  const result = await grokDeviceLoginComplete();
  if (result.status === "ok") {
    return {
      success: true,
      entityId: "xai",
      message: "Grok is connected — the xAI credential was captured and the provider activated. Build Studio can now dispatch to the grok engine via OAuth.",
      data: { status: "ok" },
    };
  }
  if (result.status === "pending") {
    return {
      success: true,
      message: "Still waiting for the operator to authorize the Grok sign-in. Poll grok_signin_status again shortly.",
      data: { status: "pending" },
    };
  }
  return { success: false, error: "device_login_failed", message: `Grok sign-in failed: ${result.detail}`, data: { status: "failed" } };
}

const handlers: Record<string, ToolPackHandler> = {
  grok_signin_start: () => grokSigninStartHandler(),
  grok_signin_status: () => grokSigninStatusHandler(),
};

export const grokSigninPack: ToolPack = {
  packId: "grok-signin",
  definitions,
  handlers,
  grants: {
    grok_signin_start: ["agent_control_read"],
    grok_signin_status: ["agent_control_read"],
  },
};
