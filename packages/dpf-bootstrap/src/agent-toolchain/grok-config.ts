/**
 * Plan idempotent edits to `~/.grok/config.toml` (or platform equiv) so the DPF
 * MCP server is enabled for the Grok CLI using the descriptor from grok.mcp.json.
 *
 * Uses smol-toml for round-tripping (no regex). Preserves other user config.
 *
 * Mirrors Codex pattern but Grok-specific (no plugins, no generic disables yet;
 * Grok is newer). Ensures [mcp_servers.dpf] with env-var token.
 *
 * Config shape from packages/dpf-skill-pack/grok.mcp.json (TOML-compatible).
 */
import { parse, stringify } from "smol-toml";

export type GrokConfigPlan = {
  /** Path/content pairs to write. Empty when already converged. */
  writes: Array<{ path: string; content: string }>;
  rationale: string;
};

// Mirrors MCP_BEARER_TOKEN_ENV_VAR
const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";
const DPF_MCP_KEY = "dpf";

function desiredMcpServerBlock(mcpEndpoint: string): Record<string, string> {
  return {
    url: mcpEndpoint,
    bearer_token_env_var: MCP_BEARER_TOKEN_ENV_VAR,
  };
}

function mcpBlockConverged(
  existing: { url?: string; bearer_token_env_var?: string } | undefined,
  mcpEndpoint: string,
): boolean {
  return (
    existing?.url === mcpEndpoint &&
    existing?.bearer_token_env_var === MCP_BEARER_TOKEN_ENV_VAR
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
  const desiredDpf = desiredMcpServerBlock(mcpEndpoint);

  const writes: Array<{ path: string; content: string }> = [];

  if (!existingDpf || !mcpBlockConverged(existingDpf, mcpEndpoint)) {
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
      ? "wrote [mcp_servers.dpf] into Grok config.toml for DPF MCP"
      : "Grok config.toml already converged for DPF",
  };
}
