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

/**
 * Call an MCP tool and return its parsed result payload.
 *
 * Mirrors scripts/gate-worktree.sh's `mcp_call | extract_tool_result`: the
 * JSON-RPC response's `result.content` array is searched for a `text` entry
 * (the shape the DPF MCP server returns tool results in), which is itself
 * JSON and holds the actual `{ success, entityId, error, ... }` payload.
 * Falls back to `result.structuredContent` or `result` for other transports.
 */
export async function mcpCall(toolName, args, { mcpUrl, bearerToken } = {}) {
  if (!mcpUrl) throw new Error("mcpCall: mcpUrl is required");
  if (!bearerToken) throw new Error("mcpCall: bearerToken is required");

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
    req.on("error", reject);
    req.write(body);
    req.end();
    });

  return extractToolResult(payload);
}

// Contract-test seam retained while the POSIX gate converges on this canonical
// Node client. Production has no curl dependency; an explicitly injected
// executable receives the former curl-compatible argv without a command shell.
async function callInjectedCurlTransport({ command, mcpUrl, bearerToken, body }) {
  const args = [
    "-sS",
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
