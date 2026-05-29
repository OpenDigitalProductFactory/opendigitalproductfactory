/**
 * Plan idempotent edits to `~/.codex/config.toml` so the DPF skill pack is
 * enabled for the Codex CLI without clobbering any unrelated user config.
 *
 * Round-trips through `smol-toml` — never regex. Every other declared block
 * is byte-equivalent across plan applications. User intent (`enabled = false`
 * set manually by the operator) is preserved.
 */

import { parse, stringify } from "smol-toml";

export type CodexConfigPlan = {
  /** Path/content pairs to write. Empty when the file already converged. */
  writes: Array<{ path: string; content: string }>;
  /** Path entries to delete. Empty in this BI; reserved for future use. */
  deletes: Array<{ path: string }>;
  /** Human-readable explanation surfaced in install-state for diagnostics. */
  rationale: string;
  /** True when the user has explicitly disabled the plugin and the plan respects it. */
  preservedUserIntent: boolean;
};

const DPF_PLUGIN_KEY = "dpf-platform";
// Mirrors MCP_BEARER_TOKEN_ENV_VAR in apps/web/lib/auth/mcp-setup-snippets.ts.
// Duplicated as a stable literal because this installer-side package must not
// depend on the web bundle. Keep the two in lockstep.
const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";

/** Desired `[mcp_servers.dpf]` shape (secret-free — references the env var). */
function desiredMcpServerBlock(mcpEndpoint: string): Record<string, string> {
  return { url: mcpEndpoint, bearer_token_env_var: MCP_BEARER_TOKEN_ENV_VAR };
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

/**
 * Plan the Codex `config.toml` upsert for this contributor and repo.
 *
 * Converges two independent, secret-free blocks:
 *   - `[plugins."dpf-platform"]` enabled = true (the DPF skill pack)
 *   - `[mcp_servers.dpf]` url + bearer_token_env_var (the governed MCP transport),
 *     written only when `mcpEndpoint` is supplied.
 *
 * - `existingTomlText` is the file's current text (or "" for a fresh contributor).
 * - `repoRoot` is the absolute path of the contributor's DPF clone. Recorded in
 *   the plan rationale; not embedded in the TOML.
 * - `configPath` is the absolute path where the plan would write back.
 * - `mcpEndpoint` is the `/api/mcp/v1` URL. When omitted, the MCP block is left
 *   untouched (back-compat with callers that only manage the plugin block).
 *
 * Returns zero writes when the file is unparseable, zero writes when both
 * blocks already match the desired state, and a single full-file write with
 * the upserted blocks otherwise. Every other block is preserved byte-for-byte
 * via smol-toml round-tripping. A user-set `enabled = false` on the plugin is
 * honored (never silently re-enabled); MCP wiring is independent of that intent.
 */
export function planCodexConfig(
  existingTomlText: string,
  repoRoot: string,
  configPath: string,
  mcpEndpoint?: string,
): CodexConfigPlan {
  let parsed: Record<string, unknown>;
  try {
    parsed = (existingTomlText.length > 0 ? parse(existingTomlText) : {}) as Record<string, unknown>;
  } catch (err) {
    return {
      writes: [],
      deletes: [],
      rationale: `TOML parse error; refusing to write. (${(err as Error).message})`,
      preservedUserIntent: false,
    };
  }

  const plugins = (parsed["plugins"] as Record<string, unknown> | undefined) ?? {};
  const existingBlock = plugins[DPF_PLUGIN_KEY] as { enabled?: boolean } | undefined;
  const userDisabledPlugin = existingBlock?.enabled === false;
  const pluginConverged = existingBlock?.enabled === true || userDisabledPlugin;

  const mcpServers = (parsed["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  const existingMcp = mcpServers["dpf"] as
    | { url?: string; bearer_token_env_var?: string }
    | undefined;
  const wantMcp = typeof mcpEndpoint === "string" && mcpEndpoint.length > 0;
  const mcpConverged = !wantMcp || mcpBlockConverged(existingMcp, mcpEndpoint!);

  // Nothing to do — both blocks already match desired state.
  if (pluginConverged && mcpConverged) {
    return {
      writes: [],
      deletes: [],
      rationale: userDisabledPlugin
        ? `Codex plugin disabled by user (preserved); MCP block ${wantMcp ? "already converged" : "unmanaged"}.`
        : "Codex plugin + MCP block already converged; no write needed.",
      preservedUserIntent: userDisabledPlugin,
    };
  }

  const nextParsed: Record<string, unknown> = { ...parsed };
  const rationaleParts: string[] = [];

  // Plugin block: add/enable unless the user explicitly disabled it.
  if (!pluginConverged) {
    const nextPlugins: Record<string, unknown> = { ...plugins };
    nextPlugins[DPF_PLUGIN_KEY] = { ...(existingBlock ?? {}), enabled: true };
    nextParsed["plugins"] = nextPlugins;
    rationaleParts.push(`enable [plugins."${DPF_PLUGIN_KEY}"]`);
  }

  // MCP transport block: independent of plugin-enable intent.
  if (wantMcp && !mcpConverged) {
    const nextMcpServers: Record<string, unknown> = { ...mcpServers };
    nextMcpServers["dpf"] = { ...(existingMcp ?? {}), ...desiredMcpServerBlock(mcpEndpoint!) };
    nextParsed["mcp_servers"] = nextMcpServers;
    rationaleParts.push("upsert [mcp_servers.dpf]");
  }

  return {
    writes: [{ path: configPath, content: stringify(nextParsed) }],
    deletes: [],
    rationale: `${rationaleParts.join(" + ")} for ${repoRoot}.`,
    preservedUserIntent: userDisabledPlugin,
  };
}
