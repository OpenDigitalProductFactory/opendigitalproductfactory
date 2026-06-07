"use server";

// Grok (xAI) device-code OAuth — the "sign in with Google" alternative to pasting
// an xAI API key. Mirrors how Codex obtains a ChatGPT OAuth token, but uses the
// Grok CLI's own device-code flow instead of an in-portal authorization-code redirect:
//
//   1. startGrokDeviceLogin() runs `grok login --device-auth` (detached) inside the
//      sandbox — the only place the `grok` binary lives — and returns the
//      accounts.x.ai/oauth2/device verification URL + user code for the operator.
//   2. The operator opens the URL and signs in with the account-level method they
//      enabled at xAI (Google / X / Apple). The CLI then writes ~/.grok/auth.json.
//   3. completeGrokDeviceLogin() reads that auth.json out of the sandbox and stores
//      it (encrypted) as the xAI credential. The build dispatch injects it back into
//      each build sandbox's ~/.grok/auth.json (see grok-dispatch ensureGrokAuth), and
//      the CLI self-refreshes from the embedded refresh token.
//
// Requires the grok-equipped sandbox image (Dockerfile.sandbox installs `grok`).
// Both actions are gated on manage_provider_connections and are safe to call from a
// human-facing button or, later, an MCP tool for AI-Coworker-driven setup.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/credential-crypto";
import { activateProvider } from "@/lib/govern/activate-provider";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const XAI_PROVIDER_ID = "xai";
const LOGIN_OUT = "/tmp/grok-device-login.out";

async function requireManageProviders(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
}

function dockerExecAsync(): (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }> {
  const { exec } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(exec) as (cmd: string, opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
  return (cmd, opts) => execAsync(cmd, opts).catch(() => ({ stdout: "", stderr: "" }));
}

export async function startGrokDeviceLogin(): Promise<
  { verificationUrl: string; userCode: string } | { error: string }
> {
  try {
    await requireManageProviders();
  } catch {
    return { error: "Your admin session expired — sign in again and retry." };
  }

  const execAsync = dockerExecAsync();

  // Fresh start: clear any prior credential file + output, then launch the device-auth
  // flow detached as the `node` user (same user the build dispatch runs grok as).
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

export async function completeGrokDeviceLogin(): Promise<
  { status: "ok" } | { status: "pending" } | { status: "failed"; detail: string }
> {
  try {
    await requireManageProviders();
  } catch {
    return { status: "failed", detail: "Your admin session expired — sign in again and retry." };
  }

  const execAsync = dockerExecAsync();

  // The login process writes ~/.grok/auth.json on success.
  const { stdout: authJson } = await execAsync(
    `docker exec --user node ${SANDBOX_CONTAINER} sh -c "cat ~/.grok/auth.json 2>/dev/null || true"`,
    { timeout: 5_000 },
  );
  const blob = authJson.trim();

  if (blob.startsWith("{")) {
    // Persist the auth.json blob as the xAI credential. The build dispatch injects it
    // verbatim into each sandbox's ~/.grok/auth.json; the CLI self-refreshes from the
    // embedded refresh token. We store it in `cachedToken` and deliberately preserve any
    // existing `secretRef` (API key): the CLI-dispatch path detects OAuth by the auth.json
    // blob shape (grok-dispatch ensureGrokAuth), while xAI *inference* (chat) keeps using
    // the API key via the unchanged `api_key` authMethod — the two paths don't collide.
    await prisma.credentialEntry.upsert({
      where: { providerId: XAI_PROVIDER_ID },
      create: { providerId: XAI_PROVIDER_ID, cachedToken: encryptSecret(blob), status: "ok" },
      update: { cachedToken: encryptSecret(blob), status: "ok" },
    });
    // Activate the provider properly (status/clearance/linked services) without overriding
    // authMethod — leaving it as `api_key` so inference auth resolution is unaffected.
    await activateProvider(XAI_PROVIDER_ID, { trigger: "oauth_exchange", activateLinked: true });
    return { status: "ok" };
  }

  // Not authorized yet — distinguish "still waiting" from a failed/expired attempt.
  const { stdout: out } = await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "cat ${LOGIN_OUT} 2>/dev/null || true"`,
    { timeout: 5_000 },
  );
  if (/error|failed|timed out|expired/i.test(out) && !/Waiting for authorization/i.test(out)) {
    return { status: "failed", detail: out.slice(-300) };
  }
  return { status: "pending" };
}
