/**
 * Plan idempotent edits to `~/.grok/config.toml` (or platform equiv) so the DPF
 * MCP server is enabled for the Grok CLI using the descriptor from grok.mcp.json.
 *
 * Uses smol-toml for round-tripping (no regex). Preserves other user config.
 *
 * Mirrors Codex pattern but Grok-specific (no plugins, no generic disables yet;
 * Grok is newer). Ensures [mcp_servers.dpf] points at bearer_token_file.
 * The refresher rewrites that file (design 12.4.7). The env var is removed
 * because it is the running process environment.
 *
 * Config shape from packages/dpf-skill-pack/grok.mcp.json (TOML-compatible).
 */
import { parse, stringify } from "smol-toml";

export type GrokConfigPlan = {
  /** Path/content pairs to write. Empty when already converged. */
  writes: Array<{ path: string; content: string }>;
  rationale: string;
};

const DPF_MCP_KEY = "dpf";
const GROK_BEARER_FILE_NAME = "dpf-mcp-token";

/** Sibling of the config file. Matches scripts/lib/grok-credential.mjs. */
export function grokBearerTokenFilePath(configPath: string): string {
  let end = configPath.length;
  while (end > 0 && (configPath[end - 1] === "/" || configPath[end - 1] === "\\")) end -= 1;
  const normalized = configPath.slice(0, end);
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const sep = cut >= 0 && normalized[cut] === "\\" ? "\\" : "/";
  const dir = cut >= 0 ? normalized.slice(0, cut) : ".";
  return `${dir}${sep}${GROK_BEARER_FILE_NAME}`;
}

function desiredMcpServerBlock(
  mcpEndpoint: string,
  configPath: string,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  delete next.bearer_token_env_var;
  next.url = mcpEndpoint;
  next.bearer_token_file = grokBearerTokenFilePath(configPath);
  return next;
}

function mcpBlockConverged(
  existing: { url?: string; bearer_token_file?: string; bearer_token_env_var?: string } | undefined,
  mcpEndpoint: string,
  configPath: string,
): boolean {
  return (
    existing?.url === mcpEndpoint &&
    existing?.bearer_token_file === grokBearerTokenFilePath(configPath) &&
    existing?.bearer_token_env_var == null
  );
}

export function planGrokConfig(
  existingText: string,
  repoRoot: string,
  configPath: string,
  mcpEndpoint: string,
): GrokConfigPlan {
  void repoRoot;
  const normalizedText = existingText.replace(/^\uFEFF/, "");
  let existing: any = {};
  try {
    existing = normalizedText ? (parse(normalizedText) as any) : {};
  } catch (err) {
    return {
      writes: [],
      rationale: `TOML parse error; refusing to write. (${(err as Error).message})`,
    };
  }
  const existingDpf = existing.mcp_servers?.[DPF_MCP_KEY];
  const desiredDpf = desiredMcpServerBlock(mcpEndpoint, configPath, existingDpf);

  const writes: Array<{ path: string; content: string }> = [];

  if (!existingDpf || !mcpBlockConverged(existingDpf, mcpEndpoint, configPath)) {
    const newConfig = { ...existing };
    newConfig.mcp_servers = {
      ...(newConfig.mcp_servers || {}),
      [DPF_MCP_KEY]: desiredDpf,
    };
    writes.push({
      path: configPath,
      content: stringify(newConfig),
    });
  }

  return {
    writes,
    rationale: writes.length
      ? "wrote [mcp_servers.dpf] bearer_token_file for the Grok credentials refresher"
      : "Grok config.toml already converged for DPF",
  };
}
