// One read-only quiescence contract for early host preflight and late admission.
import { parseArgs } from "node:util";
import { scriptArgv } from "./script-argv.mjs";
import { mcpCall } from "./mcp-client.mjs";
import { exchangeClientCredentials, resolveMcpCredential } from "./mcp-credential.mjs";

export function quiescenceBlocksWrites(status) {
  return status?.writesRefused === true
    || status?.level === "draining" || status?.level === "swapping";
}

export function quiescenceWait(status) {
  const retry = Number(status.retryAfterSeconds);
  return {
    status: "waiting", code: "local_ci_quiescence_wait",
    runId: status.runId ?? status.activeCoordinator?.runId ?? null,
    level: status.level ?? "quiescing",
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : 30,
    resumeMode: "durable-quiescence",
  };
}

export async function readQuiescenceStatus({
  mcpUrl, bearerToken, timeoutMs = 10_000, allowNonLoopbackEndpoint = false,
  mcpCallImpl = mcpCall, warn = (text) => process.stderr.write(text),
  strictConnection = false,
} = {}) {
  try {
    const response = await mcpCallImpl("get_quiescence_status", {}, {
      mcpUrl, bearerToken, timeoutMs, allowNonLoopbackEndpoint,
    });
    const status = response?.data ?? response;
    if (response?.success === true && (quiescenceBlocksWrites(status) || status?.level === "normal")) {
      return status;
    }
  } catch (error) {
    // A slow read does not establish a TLS failure or an authoritative drain.
    // Keep the existing unknown-state path; late admission still owns writes.
    if (strictConnection && error?.code && error.code !== "ETIMEDOUT") throw error;
    // Do not echo failed payloads, credential paths, or transport secrets.
  }
  warn("gate-worktree: quiescence check inconclusive; continuing existing preflight/admission checks, not recording a verdict.\n");
  return null;
}

export async function readEarlyQuiescenceStatus({
  args = [], env = process.env, warn,
  resolveCredentialImpl = resolveMcpCredential, mcpCallImpl = mcpCall,
  strictConnection = false,
} = {}) {
  try {
    const { values } = parseArgs({ args: scriptArgv(args), strict: false, allowPositionals: true,
      options: { "mcp-url": { type: "string" } } });
    const explicitUrl = values["mcp-url"];
    const mcpUrl = explicitUrl || env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
    const credential = resolveCredentialImpl({ mcpUrl, env,
      exchange: (options) => exchangeClientCredentials({ ...options, timeoutMs: 2_500 }) });
    return await readQuiescenceStatus({ mcpUrl, bearerToken: credential.bearer,
      timeoutMs: 2_500, allowNonLoopbackEndpoint: Boolean(explicitUrl), mcpCallImpl, warn, strictConnection });
  } catch (error) {
    if (strictConnection && error?.code && error.code !== "ETIMEDOUT") throw error;
    (warn ?? ((text) => process.stderr.write(text)))(
      "pregate: early quiescence check unavailable; continuing existing preflight/admission checks, not recording a verdict.\n",
    );
    return null;
  }
}
