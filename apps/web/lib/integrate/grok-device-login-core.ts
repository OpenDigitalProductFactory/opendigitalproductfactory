// Core logic for Grok (xAI) device-code OAuth — shared by the operator server actions
// (lib/actions/grok-device-login.ts, which add the manage_provider_connections session
// check) and the MCP tools (mcp-tools.ts, which gate on the same capability via the
// bearer token before dispatch). Kept auth-free so both callers can reuse it without the
// server-action `auth()` session, which is absent in the MCP/bearer context.
//
// See docs/superpowers/specs/2026-06-07-grok-device-code-oauth-design.md.

import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/credential-crypto";
import { activateProvider } from "@/lib/govern/activate-provider";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const XAI_PROVIDER_ID = "xai";
const LOGIN_OUT = "/tmp/grok-device-login.out";

function dockerExecAsync(): (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }> {
  const { exec } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(exec) as (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
  return (cmd, opts) => execAsync(cmd, opts).catch(() => ({ stdout: "", stderr: "" }));
}

/**
 * Launch the Grok CLI device-code flow inside the sandbox and return the verification
 * URL + user code for a human to authorize in a browser.
 */
export async function grokDeviceLoginStart(): Promise<
  { verificationUrl: string; userCode: string } | { error: string }
> {
  const execAsync = dockerExecAsync();

  // Fresh start: clear any prior credential file + output, then launch device-auth
  // detached as the `node` user (same user the build dispatch runs grok as).
  await execAsync(
    `docker exec --user node ${SANDBOX_CONTAINER} sh -c "mkdir -p ~/.grok; rm -f ~/.grok/auth.json ${LOGIN_OUT}"`,
    { timeout: 10_000 },
  );
  await execAsync(
    `docker exec -d --user node ${SANDBOX_CONTAINER} sh -c "grok login --device-auth > ${LOGIN_OUT} 2>&1"`,
    { timeout: 10_000 },
  );

  // grok prints the verification URL + user code immediately, then blocks on
  // "Waiting for authorization...". Poll the captured output for the URL.
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 700));
    const { stdout } = await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "cat ${LOGIN_OUT} 2>/dev/null || true"`,
      { timeout: 5_000 },
    );
    const urlMatch = stdout.match(/https:\/\/\S*oauth2\/device\S*/);
    if (urlMatch) {
      const codeMatch =
        stdout.match(/user_code=([A-Za-z0-9-]+)/) ?? stdout.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      return { verificationUrl: urlMatch[0], userCode: codeMatch?.[1] ?? "" };
    }
    if (/not found|no such file|executable file not found/i.test(stdout)) break;
  }

  return {
    error:
      "Grok did not return a device-code URL. Ensure the `grok` CLI is installed in the build sandbox (Dockerfile.sandbox) and the sandbox is running, then retry.",
  };
}

/**
 * Check whether the device-code sign-in has been authorized; on success, store the
 * captured ~/.grok/auth.json as the xAI credential and activate the provider.
 */
export async function grokDeviceLoginComplete(): Promise<
  { status: "ok" } | { status: "pending" } | { status: "failed"; detail: string }
> {
  const execAsync = dockerExecAsync();

  const { stdout: authJson } = await execAsync(
    `docker exec --user node ${SANDBOX_CONTAINER} sh -c "cat ~/.grok/auth.json 2>/dev/null || true"`,
    { timeout: 5_000 },
  );
  const blob = authJson.trim();

  if (blob.startsWith("{")) {
    // Store the auth.json blob (encrypted) in cachedToken; preserve any existing
    // secretRef (API key). Dispatch detects OAuth by blob shape; inference keeps using
    // the api_key authMethod — the two paths don't collide.
    await prisma.credentialEntry.upsert({
      where: { providerId: XAI_PROVIDER_ID },
      create: { providerId: XAI_PROVIDER_ID, cachedToken: encryptSecret(blob), status: "ok" },
      update: { cachedToken: encryptSecret(blob), status: "ok" },
    });
    await activateProvider(XAI_PROVIDER_ID, { trigger: "oauth_exchange", activateLinked: true });
    return { status: "ok" };
  }

  const { stdout: out } = await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "cat ${LOGIN_OUT} 2>/dev/null || true"`,
    { timeout: 5_000 },
  );
  if (/error|failed|timed out|expired/i.test(out) && !/Waiting for authorization/i.test(out)) {
    return { status: "failed", detail: out.slice(-300) };
  }
  return { status: "pending" };
}
