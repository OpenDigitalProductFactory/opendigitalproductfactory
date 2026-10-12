// Minimal MCP JSON-RPC client for Node-native gate scripts (BI-2272D840).
//
// scripts/gate-worktree.sh talks to the MCP endpoint via `curl` + `node -e`
// JSON plumbing. That is fine when a POSIX shell is available to glue the
// pieces together, but the whole point of the Node-native pregate path is to
// not depend on one. This module is the same JSON-RPC "tools/call" contract
// implemented with plain node:http/https requests instead.
//
// Deliberately NOT using the global `fetch` (undici): undici pools/keeps
// connections alive, and a process.exit() called right after a fetch leaves
// a libuv handle mid-teardown — observed live as a native crash
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", garbled exit
// code) on Windows immediately after gate-worktree.mjs's final MCP call.
// `agent: false` + `Connection: close` guarantees the socket is closed
// before the response resolves, so there is nothing left open to race
// against process.exit().

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { materializeBearer } from "./mcp-credential.mjs";

let callId = 0;

// Loopback hostnames the local portal is ever published on. `new URL(...)`
// keeps the brackets on an IPv6 host, so the bracketed form is the literal to
// compare against.
const LOOPBACK_MCP_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Shape of a loopback MCP endpoint, as written by scripts/sync-mcp-worktrees.ps1.
// Requiring `/` (or end of string) straight after the optional port is what
// rejects a credentials-in-authority redirect such as
// `http://127.0.0.1@example.com/api/mcp/v1`, where the loopback literal is the
// username and the real host is remote.
const LOOPBACK_MCP_URL = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/.*)?$/i;

/** Parse `value` into a URL origin key (`scheme//host[:port]`, lowercased,
 *  default port dropped), or null when it is absent, malformed, not http(s)
 *  or carries credentials in its authority. */
function originKey(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
}

/**
 * The origins the install is CONFIGURED on, from the environment: the
 * canonical `PUBLIC_URL` (design §12.4.1) and the origin of the operator-set
 * `DPF_MCP_URL` / `DPF_MCP_ENDPOINT`, which S2 persists as
 * `<PUBLIC_URL>/api/mcp/v1?tier=full`. Environment is stated configuration,
 * unlike an on-disk `.mcp.json`, so an endpoint on one of these origins is the
 * install itself rather than whatever host a file happens to name.
 */
function configuredMcpOrigins(env) {
  return [env?.PUBLIC_URL, env?.DPF_MCP_URL, env?.DPF_MCP_ENDPOINT]
    .map(originKey)
    .filter((origin) => origin !== null);
}

/**
 * Is this an MCP endpoint a `dpfmcp_...` bearer token may be sent to?
 *
 * A bearer token is a live DPF credential carrying a read/write/admin scope
 * (AGENTS.md section 6). Callers that resolve an endpoint from on-disk config
 * rather than from explicit operator input must run the candidate through this
 * check first: a copied-in, stale or tampered `.mcp.json` otherwise redirects
 * the token to whatever host it names, which is uncontrolled credential
 * disclosure (CWE-200) rather than a connection failure.
 *
 * Allowed: loopback (`127.0.0.1`, `localhost`, `[::1]`), and an endpoint whose
 * origin (scheme, host and port) equals one the install is configured on in
 * the environment -- `PUBLIC_URL`, `DPF_MCP_URL` or `DPF_MCP_ENDPOINT`
 * (BI-8A562681, design §12.4.5). Everything else is refused, including a
 * credentials-in-authority URL that merely looks like an allowed host.
 */
export function isAllowedMcpEndpoint(candidate, env = process.env) {
  if (typeof candidate !== "string") return false;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (LOOPBACK_MCP_URL.test(candidate) && LOOPBACK_MCP_HOSTS.has(parsed.hostname)) return true;
  const candidateOrigin = originKey(candidate);
  return candidateOrigin !== null && configuredMcpOrigins(env).includes(candidateOrigin);
}

/**
 * Serialize one JSON-RPC 2.0 request. The only place in scripts/ that builds
 * the envelope (plan 2026-09-08 §10.5 S8; ratchet
 * scripts/check-no-hand-rolled-mcp-jsonrpc.mjs).
 */
export function buildJsonRpcBody(method, params) {
  callId += 1;
  return JSON.stringify({
    jsonrpc: "2.0",
    id: callId,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

/**
 * POST one JSON-RPC request to the MCP endpoint and return the raw reply as
 * `{ status, text }`. The HTTP status is NOT interpreted: a caller that must
 * fail open on a 401 or 5xx decides that itself. Throws on a missing URL or
 * credential, a refused endpoint, a transport error and a timeout.
 *
 * Transport, first match wins:
 *   - `fetchImpl`: a fetch-compatible function (tests; callers that already
 *     inject one). It gets an AbortSignal for the deadline.
 *   - DPF_GATE_CURL_BIN: the contract-test curl seam below.
 *   - plain node:http/https with `agent: false` + `Connection: close` (see the
 *     header comment for why not the global fetch).
 *
 * `label` names the call in the timeout message; it defaults to the tool name
 * for tools/call and to the method otherwise.
 */
export async function mcpPost(method, params, {
  mcpUrl,
  bearerToken,
  timeoutMs = 10_000,
  allowNonLoopbackEndpoint = false,
  accept,
  fetchImpl,
  label,
} = {}) {
  if (!mcpUrl) throw new Error("mcpCall: mcpUrl is required");
  if (!bearerToken) throw new Error("mcpCall: bearerToken is required");
  // BI-78B653D5: `bearerToken` is a PAT string or a self-refreshing
  // client_credentials bearer (scripts/lib/mcp-credential.mjs). Materialize
  // it once per call so a long-running gate always sends a live token.
  const bearerValue = await materializeBearer(bearerToken);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("mcpCall: timeoutMs must be a positive number");
  }
  // Default-deny, checked HERE rather than left to each caller.
  //
  // isAllowedMcpEndpoint has existed for a while, but only one of the sixteen
  // call sites ever ran it, so everywhere else the rule documented above it was
  // a convention rather than an invariant: a caller resolving its endpoint from
  // on-disk config would send a live `dpfmcp_...` credential to whatever host
  // that file named (CWE-200, and what CodeQL's js/file-access-to-http reports
  // on this module). Enforcing it here inverts the failure mode -- a caller that
  // never thought about the endpoint now fails closed instead of leaking.
  //
  // The install's configured origins (PUBLIC_URL, and the origin of an
  // operator-set DPF_MCP_URL / DPF_MCP_ENDPOINT) are configuration, so an
  // endpoint on one of them is honoured off loopback. An endpoint that merely
  // appeared in ambient state -- a copied-in, stale or tampered `.mcp.json`
  // -- naming any other host is refused. Callers with their own operator signal
  // (a --mcp-url flag) can still pass allowNonLoopbackEndpoint directly.
  if (!allowNonLoopbackEndpoint && !isAllowedMcpEndpoint(mcpUrl)) {
    throw new Error(
      `mcpCall: refusing to send a bearer token to ${mcpUrl}. Only loopback MCP `
      + "endpoints and the install's configured origin (PUBLIC_URL, DPF_MCP_URL or "
      + "DPF_MCP_ENDPOINT) are allowed. An endpoint read from on-disk config is "
      + "ambient state, not operator intent, and a live credential is not sent to it.",
    );
  }

  const callLabel = label ?? (method === "tools/call" && params?.name ? params.name : method);
  const body = buildJsonRpcBody(method, params);
  const headers = {
    Authorization: `Bearer ${bearerValue}`,
    "Content-Type": "application/json",
    ...(accept ? { Accept: accept } : {}),
  };

  if (fetchImpl) {
    const response = await fetchImpl(mcpUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, text: await response.text(), via: "fetch" };
  }

  const injectedTransport = process.env.DPF_GATE_CURL_BIN;
  if (injectedTransport) {
    const text = await callInjectedCurlTransport({
      command: injectedTransport,
      mcpUrl,
      bearerToken: bearerValue,
      body,
      timeoutMs,
    });
    return { status: 200, text, via: "injected" };
  }

  const url = new URL(mcpUrl);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = requestFn(url, {
      method: "POST",
      agent: false,
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data, via: "http" }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`mcpCall: ${callLabel} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Call an MCP tool and return its parsed result payload.
 *
 * Mirrors scripts/gate-worktree.sh's `mcp_call | extract_tool_result`: the
 * JSON-RPC response's `result.content` array is searched for a `text` entry
 * (the shape the DPF MCP server returns tool results in), which is itself
 * JSON and holds the actual `{ success, entityId, error, ... }` payload.
 * Falls back to `result.structuredContent` or `result` for other transports.
 * Throws on a reply that is not JSON; the HTTP status is not checked, so a
 * JSON-RPC error envelope comes back through extractToolResult as before.
 */
export async function mcpCall(toolName, args, options = {}) {
  const reply = await mcpPost("tools/call", { name: toolName, arguments: args }, options);
  try {
    return extractToolResult(JSON.parse(reply.text));
  } catch (error) {
    if (reply.via === "injected") {
      throw new Error(`mcpCall: injected transport returned invalid JSON: ${error.message}`);
    }
    throw new Error(`mcpCall: invalid JSON response from ${options.mcpUrl} (status ${reply.status}): ${error.message}`);
  }
}

// Contract-test seam retained while the POSIX gate converges on this canonical
// Node client. Production has no curl dependency; an explicitly injected
// executable receives the former curl-compatible argv without a command shell.
async function callInjectedCurlTransport({
  command,
  mcpUrl,
  bearerToken,
  body,
  timeoutMs,
}) {
  const args = [
    "-sS",
    "--max-time",
    String(Math.max(0.001, timeoutMs / 1_000)),
    "-X",
    "POST",
    mcpUrl,
    "-H",
    `Authorization: Bearer ${bearerToken}`,
    "-H",
    "Content-Type: application/json",
    "--data",
    body,
  ];
  const win32 = process.platform === "win32";
  const executable = win32 ? "sh" : command;
  // MSYS/Git Bash `sh` splits its command line by Cygwin rules, where `\\`
  // inside a quoted argument collapses to `\`. Node quotes by MSVC rules, so a
  // JSON body carrying a Windows path arrived at the stub as invalid JSON
  // (BI-1B4910B4). Quote every argument for sh and pass the line verbatim.
  const executableArgs = win32 ? [command, ...args].map(quoteForMsysArgv) : args;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, executableArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: win32,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`mcpCall: injected transport exited ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Quote one argument so MSYS `sh` reads it back byte for byte (Cygwin rules). */
export function quoteForMsysArgv(arg) {
  return `"${String(arg).replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export function extractToolResult(payload) {
  const content = payload?.result?.content;
  if (Array.isArray(content)) {
    const textEntry = content.find((entry) => entry && entry.type === "text" && typeof entry.text === "string");
    if (textEntry) {
      try {
        return JSON.parse(textEntry.text);
      } catch {
        return textEntry.text;
      }
    }
  }
  return payload?.result?.structuredContent ?? payload?.result ?? payload;
}
