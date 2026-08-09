#!/usr/bin/env node
/**
 * Credential-safe protocol probe for DPF MCP progressive tool disclosure.
 *
 * Reads DPF_MCP_BEARER_TOKEN from the environment and never prints it. The
 * profiles exercise server behavior at the HTTP/MCP boundary; they do not
 * claim that a particular host UI consumed list_changed unless that host was
 * separately observed live.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

export const CLIENT_PROFILES = Object.freeze([
  { name: "Codex Desktop", userAgent: "codex-desktop/conformance", expectedDefault: "core" },
  { name: "Codex CLI", userAgent: "codex-cli/conformance", expectedDefault: "core" },
  { name: "Claude Code", userAgent: "claude-code/conformance", expectedDefault: "full" },
  { name: "Generic MCP", userAgent: "generic-mcp-client/conformance", expectedDefault: "core" },
]);

export function parseMcpMessages(contentType, body) {
  if (/text\/event-stream/i.test(contentType ?? "")) {
    return body
      .split(/\r?\n\r?\n/)
      .flatMap((frame) => frame.split(/\r?\n/).filter((line) => line.startsWith("data:")))
      .map((line) => JSON.parse(line.slice(5).trim()));
  }
  return body.trim() ? [JSON.parse(body)] : [];
}

export function sameToolNames(left, right) {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function withTier(rawUrl, tier) {
  const url = new URL(rawUrl);
  url.searchParams.set("tier", tier);
  return url.toString();
}

let requestId = 0;
async function rpc(urlString, bearerToken, userAgent, method, params, options = {}) {
  requestId += 1;
  const id = requestId;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  const url = new URL(urlString);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestFn(url, {
      method: "POST",
      agent: false,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": userAgent,
        Accept: options.acceptEventStream ? "application/json, text/event-stream" : "application/json",
        "MCP-Protocol-Version": "2025-11-25",
        Connection: "close",
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        try {
          const messages = parseMcpMessages(response.headers["content-type"], responseBody);
          resolve({ status: response.statusCode, messages, reply: messages.find((m) => m.id === id) });
        } catch (error) {
          reject(new Error(`invalid MCP response (HTTP ${response.statusCode}): ${error.message}`));
        }
      });
    });
    request.setTimeout(options.timeoutMs ?? 10_000, () => {
      request.destroy(new Error(`MCP ${method} timed out`));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toolNames(reply) {
  return new Set((reply?.result?.tools ?? []).map((tool) => tool.name));
}

function resultData(reply) {
  return reply?.result?.structuredContent ?? {};
}

function readOnlyNoArgCandidate(fullTools, coreNames, excluded = new Set()) {
  return fullTools.find((tool) =>
    !coreNames.has(tool.name)
    && !excluded.has(tool.name)
    && tool.annotations?.readOnlyHint === true
    && (tool.inputSchema?.required?.length ?? 0) === 0,
  );
}

async function runProfile(profile, mcpUrl, bearerToken) {
  const initialize = await rpc(mcpUrl, bearerToken, profile.userAgent, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: profile.name, version: "conformance" },
  });
  assert(initialize.status === 200, `${profile.name}: initialize HTTP ${initialize.status}`);
  const preamble = String(initialize.reply?.result?.instructions ?? "").slice(0, 512);
  for (const required of ["load_tools", "names", "query", "tools/list", "Resources", "authorization"]) {
    assert(preamble.includes(required), `${profile.name}: initialize preamble is missing ${required}`);
  }

  const defaultList = await rpc(mcpUrl, bearerToken, profile.userAgent, "tools/list");
  const coreList = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/list");
  const fullList = await rpc(withTier(mcpUrl, "full"), bearerToken, profile.userAgent, "tools/list");
  const defaultNames = toolNames(defaultList.reply);
  const coreNames = toolNames(coreList.reply);
  const fullTools = fullList.reply?.result?.tools ?? [];
  assert(coreNames.has("load_tools"), `${profile.name}: load_tools absent from core tools/list`);
  assert(
    profile.expectedDefault === "full"
      ? sameToolNames(defaultNames, toolNames(fullList.reply))
      : sameToolNames(defaultNames, coreNames),
    `${profile.name}: unexpected default disclosure tier`,
  );

  const exactCandidate = readOnlyNoArgCandidate(fullTools, coreNames);
  assert(exactCandidate, `${profile.name}: no safe deferred exact-name candidate`);
  const exactLoad = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/call", {
    name: "load_tools",
    arguments: { names: [exactCandidate.name] },
  });
  const exactLoadData = resultData(exactLoad.reply);
  assert(
    exactLoadData.newlyLoaded?.some((tool) => tool.name === exactCandidate.name),
    `${profile.name}: exact-name load failed`,
  );
  assert(
    exactLoadData.recovery?.reListTools === true
      && exactLoadData.recovery?.programmaticCatalogFallback === true,
    `${profile.name}: stale top-level registry recovery is missing`,
  );
  const afterExact = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/list");
  const afterNames = toolNames(afterExact.reply);
  assert([...coreNames].every((name) => afterNames.has(name)), `${profile.name}: core floor was swapped`);
  assert(afterNames.has(exactCandidate.name), `${profile.name}: same-session re-list missed exact tool`);

  const useLoaded = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/call", {
    name: exactCandidate.name,
    arguments: {},
  });
  assert(
    useLoaded.reply?.result?.structuredContent?.error !== "unknown_tool",
    `${profile.name}: loaded tool remained unknown in the same session`,
  );

  const intentLoad = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/call", {
    name: "load_tools",
    arguments: { query: "claim a backlog item and bind it to my worktree" },
  });
  const intentNames = (resultData(intentLoad.reply).newlyLoaded ?? []).map((tool) => tool.name);
  assert(
    intentNames.includes("claim_backlog_item_for_work"),
    `${profile.name}: natural-language claim/worktree intent did not resolve`,
  );

  const sseCandidate = readOnlyNoArgCandidate(fullTools, afterNames, new Set([exactCandidate.name]));
  assert(sseCandidate, `${profile.name}: no safe deferred SSE candidate`);
  const sseLoad = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/call", {
    name: "load_tools",
    arguments: { names: [sseCandidate.name] },
  }, { acceptEventStream: true });
  assert(
    sseLoad.messages.some((message) => message.method === "notifications/tools/list_changed"),
    `${profile.name}: list_changed notification absent from SSE response`,
  );

  const unknown = await rpc(withTier(mcpUrl, "core"), bearerToken, profile.userAgent, "tools/call", {
    name: "conformance_tool_that_does_not_exist",
    arguments: {},
  });
  assert(
    resultData(unknown.reply).error === "unknown_tool"
      && resultData(unknown.reply).recovery?.tool === "load_tools",
    `${profile.name}: unknown-tool recovery is not structured`,
  );

  return {
    profile: profile.name,
    defaultTier: profile.expectedDefault,
    coreCount: coreNames.size,
    exactTool: exactCandidate.name,
    sseTool: sseCandidate.name,
    intentTool: "claim_backlog_item_for_work",
    status: "pass",
  };
}

async function verifyFailureClassification(mcpUrl, profile) {
  const invalidAuth = await rpc(
    mcpUrl,
    "dpfmcp_conformance_invalid",
    profile.userAgent,
    "tools/list",
  );
  assert(invalidAuth.status === 401, `invalid credential should be HTTP 401, got ${invalidAuth.status}`);

  let disconnected = false;
  try {
    await rpc("http://127.0.0.1:1/api/mcp/v1", "not-logged", profile.userAgent, "tools/list", null, {
      timeoutMs: 500,
    });
  } catch {
    disconnected = true;
  }
  assert(disconnected, "closed endpoint was not classified as a connection failure");
}

export async function runConformance({ mcpUrl, bearerToken }) {
  if (!mcpUrl) throw new Error("DPF_MCP_URL (or --url) is required");
  if (!bearerToken) throw new Error("DPF_MCP_BEARER_TOKEN is required");
  const results = [];
  for (const profile of CLIENT_PROFILES) {
    results.push(await runProfile(profile, mcpUrl, bearerToken));
  }
  await verifyFailureClassification(mcpUrl, CLIENT_PROFILES[0]);
  return results;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const urlArgIndex = process.argv.indexOf("--url");
  const mcpUrl = urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : process.env.DPF_MCP_URL;
  try {
    const results = await runConformance({
      mcpUrl,
      bearerToken: process.env.DPF_MCP_BEARER_TOKEN,
    });
    process.stdout.write(`${JSON.stringify({ success: true, profiles: results }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`MCP progressive-disclosure conformance failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
