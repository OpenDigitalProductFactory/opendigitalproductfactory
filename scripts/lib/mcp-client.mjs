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
 * Operators who genuinely front the portal from another host say so explicitly
 * with `DPF_MCP_URL` / `--mcp-url`, which is intent rather than ambient state
 * and is not narrowed here.
 */
export function isAllowedMcpEndpoint(candidate) {
  if (typeof candidate !== "string" || !LOOPBACK_MCP_URL.test(candidate)) return false;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return LOOPBACK_MCP_HOSTS.has(parsed.hostname);
}

/**
 * Call an MCP tool and return its parsed result payload.
 *
 * Mirrors scripts/gate-worktree.sh's `mcp_call | extract_tool_result`: the
 * JSON-RPC response's `result.content` array is searched for a `text` entry
 * (the shape the DPF MCP server returns tool results in), which is itself
 * JSON and holds the actual `{ success, entityId, error, ... }` payload.
 * Falls back to `result.structuredContent` or `result` for other transports.
 */
export async function mcpCall(toolName, args, {
  mcpUrl,
  bearerToken,
  timeoutMs = 10_000,
} = {}) {
  if (!mcpUrl) throw new Error("mcpCall: mcpUrl is required");
  if (!bearerToken) throw new Error("mcpCall: bearerToken is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("mcpCall: timeoutMs must be a positive number");
  }

  callId += 1;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: callId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const url = new URL(mcpUrl);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

  const injectedTransport = process.env.DPF_GATE_CURL_BIN;
  const payload = injectedTransport
    ? await callInjectedCurlTransport({
      command: injectedTransport,
      mcpUrl,
      bearerToken,
      body,
      timeoutMs,
    })
    : await new Promise((resolve, reject) => {
    const req = requestFn(url, {
      method: "POST",
      agent: false,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`mcpCall: invalid JSON response from ${mcpUrl} (status ${res.statusCode}): ${error.message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`mcpCall: ${toolName} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
    });

  return extractToolResult(payload);
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
  const executable = process.platform === "win32" ? "sh" : command;
  const executableArgs = process.platform === "win32" ? [command, ...args] : args;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(executable, executableArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`mcpCall: injected transport returned invalid JSON: ${error.message}`));
      }
    });
  });
  return output;
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
