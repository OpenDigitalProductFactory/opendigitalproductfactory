#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { emitDeny, inDpfWorkspace, readHookPayload } from "./lib/hook-io.mjs";

const SOURCE_RE = /^(apps\/web\/(?:app|lib)\/.*\.(?:ts|tsx)|packages\/[^/]+\/(?:src|prisma)\/.*\.(?:ts|tsx|sql|prisma))$/;
const EXCLUDED_RE = /(?:\.(?:test|spec|stories)\.(?:ts|tsx)$|__tests__\/|\/generated\/)/;
const PLAN_RE = /^docs\/superpowers\/plans\/.*\.md$/;

const MISSING_GUIDANCE =
  "Plan backlog coverage blocked this source edit. Before implementation, use the DPF planning workflow to record a live backlog coverage receipt: map every independently shippable deliverable to a live BacklogItem (existing mappings are valid), or record an auditable atomic rationale. Put the returned receipt and BI dependencies in the plan; Markdown checkboxes are not backlog coverage.";

function normalizePath(file, cwd = process.cwd()) {
  const normalized = String(file ?? "").replace(/\\/g, "/");
  if (!normalized) return "";
  if (!normalized.startsWith("/")) return normalized.replace(/^\.\//, "");
  return relative(cwd, normalized).replace(/\\/g, "/");
}

function isProductionSourceEdit(toolName, toolInput, cwd) {
  if (!["Write", "Edit", "MultiEdit"].includes(String(toolName))) return false;
  const file = normalizePath(toolInput?.file_path ?? toolInput?.filePath, cwd);
  return SOURCE_RE.test(file) && !EXCLUDED_RE.test(file);
}

export function parsePlanCoverage(text) {
  const itemId = text.match(/\*\*Backlog item:\*\*\s*`?(BI-[A-Z0-9-]+)`?/i)?.[1]?.toUpperCase() ?? null;
  const afterHeading = text.split(/^## Backlog coverage\s*$/im)[1] ?? "";
  const section = afterHeading.split(/^##\s/m)[0] ?? "";
  const rawDecision = section.match(/^\s*-\s*Decision:\s*(atomic|decomposed)\s*$/im)?.[1]?.toLowerCase();
  const rawReceipt = section.match(/^\s*-\s*Receipt:\s*`?([^`\n]+?)`?\s*$/im)?.[1]?.trim() ?? "";
  return {
    itemId,
    decision: rawDecision === "atomic" || rawDecision === "decomposed" ? rawDecision : null,
    receiptId: rawReceipt && !/^(?:pending|none|n\/a)\b/i.test(rawReceipt) ? rawReceipt : null,
  };
}

export async function decide({ toolName, toolInput = {}, plans = [], checkReceipt, checkBranch, branchName, cwd = process.cwd() }) {
  if (!isProductionSourceEdit(toolName, toolInput, cwd)) return { block: false };

  if (checkBranch && branchName) {
    let branchResult;
    try {
      branchResult = await checkBranch({ branchName });
    } catch (error) {
      branchResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (branchResult?.ok !== true) {
      return {
        block: true,
        reason:
          `DPF MCP could not confirm the branch planning gate before implementation: ${branchResult?.error ?? "unknown error"}. ` +
          "For xlarge work, record the required decomposition decision. For MCP/tool/scope failures, refresh the DPF plugin or token; do not bypass into Markdown.",
      };
    }
  }

  if (plans.length === 0) return { block: false };

  for (const plan of plans) {
    const coverage = parsePlanCoverage(plan.text);
    if (!coverage.itemId || !coverage.decision || !coverage.receiptId) {
      return { block: true, reason: `${MISSING_GUIDANCE} Plan: ${plan.path}.` };
    }
    let result;
    try {
      result = await checkReceipt({
        itemId: coverage.itemId,
        planPath: plan.path,
        receiptId: coverage.receiptId,
      });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!(result?.ok === true && result?.valid === true)) {
      const scope = result?.requiredScope ? ` Required scope: ${result.requiredScope}.` : "";
      const detail = result?.error ? ` MCP result: ${result.error}.` : "";
      return {
        block: true,
        reason:
          `Plan backlog coverage could not be verified through DPF MCP, so implementation is stopped.${scope}${detail} ` +
          "Refresh/install the DPF plugin and use a token with the reported scope; do not fall back to Markdown or direct database edits.",
      };
    }
  }
  return { block: false };
}

function changedPlans(cwd) {
  const names = new Set();
  const commands = [
    ["diff", "--name-only", "--diff-filter=AM", "origin/main...HEAD"],
    ["diff", "--name-only", "--diff-filter=AM"],
    ["ls-files", "--others", "--exclude-standard"],
  ];
  for (const args of commands) {
    try {
      const output = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const name of output.split(/\r?\n/)) if (PLAN_RE.test(name)) names.add(name);
    } catch {
      // A missing origin ref may occur in a standalone fixture; other probes still apply.
    }
  }
  return [...names]
    .map((path) => ({ path, fullPath: resolve(cwd, path) }))
    .filter(({ fullPath }) => existsSync(fullPath))
    .map(({ path, fullPath }) => ({ path, text: readFileSync(fullPath, "utf8") }));
}

function parseMcpResponse(raw) {
  const candidate = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .at(-1) ?? raw;
  const envelope = JSON.parse(candidate);
  const result = envelope?.result ?? envelope;
  const textEntry = Array.isArray(result?.content)
    ? result.content.find((entry) => entry?.type === "text" && typeof entry.text === "string")
    : null;
  const payload = textEntry ? JSON.parse(textEntry.text) : result?.structuredContent ?? result;
  if (payload?.structuredContent?.error) return payload.structuredContent;
  if (payload?.success === true) return { ok: true, ...(payload.data ?? {}) };
  return {
    ok: false,
    error: payload?.error ?? payload?.structuredContent?.error ?? "coverage_receipt_invalid",
    requiredScope: payload?.requiredScope ?? payload?.structuredContent?.requiredScope,
  };
}

async function callMcp(toolName, args) {
  const token = process.env.DPF_MCP_BEARER_TOKEN;
  if (!token) return { ok: false, error: "DPF_MCP_BEARER_TOKEN is missing" };
  const url = process.env.DPF_MCP_URL ?? "http://127.0.0.1:3000/api/mcp/v1";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(5000),
  });
  const raw = await response.text();
  if (!response.ok) return { ok: false, error: `MCP HTTP ${response.status}` };
  return parseMcpResponse(raw);
}

const callCoverageCheck = (args) => callMcp("check_plan_backlog_coverage", args);
const callBranchCheck = (args) => callMcp("check_branch_plan_backlog_gate", args);

async function main() {
  const payload = readHookPayload();
  if (payload === null || !inDpfWorkspace(payload.cwd)) return;
  const cwd = payload.cwd ?? process.cwd();
  let branchName = "";
  try {
    branchName = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim();
  } catch {
    // The MCP plan receipt check below still protects changed plans.
  }
  const verdict = await decide({
    toolName: payload.toolName,
    toolInput: payload.toolInput,
    plans: changedPlans(cwd),
    checkReceipt: callCoverageCheck,
    checkBranch: callBranchCheck,
    branchName,
    cwd,
  });
  if (verdict.block) emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("plan-backlog-coverage-guard.mjs")) {
  main().catch((error) => {
    emitDeny(`Plan backlog coverage guard failed before verification: ${error instanceof Error ? error.message : String(error)}. Implementation is stopped; repair or refresh the DPF toolchain rather than bypassing the guard.`);
  });
}
