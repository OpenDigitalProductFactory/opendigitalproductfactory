/**
 * Plan idempotent writes for the repo-root MCP client config files that point
 * Claude Code and VS Code at the DPF MCP server:
 *   - `<repoRoot>/.mcp.json`        (Claude Code: mcpServers.dpf, http transport)
 *   - `<repoRoot>/.vscode/mcp.json` (VS Code: servers.dpf, http transport)
 *
 * Both reference the `${DPF_MCP_BEARER_TOKEN}` env var rather than embedding the
 * secret, so these files carry NO credential and are deterministic per endpoint.
 * That is why they live in the (DB-free, secret-free) planning library and are
 * applied by the installer adapter, instead of being written by the token-mint
 * step: token rotation changes the env var, never the client config shape.
 *
 * The JSON shape is the single source of truth in
 * apps/web/lib/auth/mcp-setup-snippets.ts (buildSetupSnippets). This package
 * cannot import the web bundle, so the shape is mirrored here and guarded by
 * tests; keep the two in lockstep.
 */

import { withDpfMcpCatalogTier } from "@dpf/integration-shared/mcp-catalog-tier";

// Mirrors MCP_BEARER_TOKEN_ENV_VAR in apps/web/lib/auth/mcp-setup-snippets.ts.
const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";

export type McpClientConfigPlan = {
  /** Path/content pairs to write. Empty when both files already match. */
  writes: Array<{ path: string; content: string }>;
  rationale: string;
};

/**
 * Strip trailing '/' without a regex. `/\/+$/` trips CodeQL's js/polynomial-redos
 * rule, so we walk back from the end in linear time (no backtracking).
 */
function stripTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && p.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return p.slice(0, end);
}

/** Posix-join repoRoot + segments (installer paths are always posix on the targets we wire). */
function joinPath(repoRoot: string, ...segments: string[]): string {
  return [stripTrailingSlashes(repoRoot), ...segments].join("/");
}

/**
 * The repo-root paths this planner writes. Exported so the bridge reads the
 * exact same paths it will write (single source — no duplicated path math, no
 * second ReDoS-prone regex).
 */
export function mcpClientConfigPaths(repoRoot: string): {
  mcpJsonPath: string;
  vscodeJsonPath: string;
} {
  return {
    mcpJsonPath: joinPath(repoRoot, ".mcp.json"),
    vscodeJsonPath: joinPath(repoRoot, ".vscode", "mcp.json"),
  };
}

function claudeCodeContent(mcpEndpoint: string): string {
  const lazyHostEndpoint = withDpfMcpCatalogTier(mcpEndpoint, "full");
  return JSON.stringify(
    {
      mcpServers: {
        dpf: {
          type: "http",
          url: lazyHostEndpoint,
          headers: { Authorization: `Bearer \${${MCP_BEARER_TOKEN_ENV_VAR}}` },
        },
      },
    },
    null,
    2,
  );
}

function vscodeContent(mcpEndpoint: string): string {
  return JSON.stringify(
    {
      servers: {
        dpf: {
          type: "http",
          url: mcpEndpoint,
          headers: { Authorization: `Bearer \${env:${MCP_BEARER_TOKEN_ENV_VAR}}` },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Compute the client-config writes for `repoRoot` against `mcpEndpoint`.
 *
 * - `existingMcpJson` / `existingVscodeJson` are the current file contents (or
 *   null when absent). A write is emitted only when the file is missing or its
 *   content differs — no churn on a converged install.
 */
export function planMcpClientConfig(
  repoRoot: string,
  mcpEndpoint: string,
  existingMcpJson: string | null,
  existingVscodeJson: string | null,
): McpClientConfigPlan {
  const writes: McpClientConfigPlan["writes"] = [];

  const mcpPath = joinPath(repoRoot, ".mcp.json");
  const desiredMcp = claudeCodeContent(mcpEndpoint);
  if (existingMcpJson !== desiredMcp) {
    writes.push({ path: mcpPath, content: desiredMcp });
  }

  const vscodePath = joinPath(repoRoot, ".vscode", "mcp.json");
  const desiredVscode = vscodeContent(mcpEndpoint);
  if (existingVscodeJson !== desiredVscode) {
    writes.push({ path: vscodePath, content: desiredVscode });
  }

  return {
    writes,
    rationale:
      writes.length === 0
        ? "MCP client config already converged."
        : `Writing ${writes.length} MCP client config file(s) for ${repoRoot}.`,
  };
}
