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

/**
 * Plan the Codex `config.toml` upsert for this contributor and repo.
 *
 * - `existingTomlText` is the file's current text (or "" for a fresh contributor).
 * - `repoRoot` is the absolute path of the contributor's DPF clone. Recorded in
 *   the plan rationale; not embedded in the TOML.
 * - `configPath` is the absolute path where the plan would write back.
 *
 * Returns zero writes when the file is unparseable (with a rationale), zero
 * writes when the plugin block already matches the desired state, zero writes
 * when the user has explicitly disabled the plugin, and a single write with
 * the upserted block otherwise. Every other block is preserved.
 */
export function planCodexConfig(
  existingTomlText: string,
  repoRoot: string,
  configPath: string,
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
  const existingBlock = plugins[DPF_PLUGIN_KEY] as
    | { enabled?: boolean }
    | undefined;

  // User-intent preservation: if the user has explicitly set enabled = false,
  // the bootstrap never silently re-enables the plugin. Surfaced via rationale.
  if (existingBlock && existingBlock.enabled === false) {
    return {
      writes: [],
      deletes: [],
      rationale:
        "Codex plugin [plugins.\"dpf-platform\"] is set to enabled=false by the user; preserving user intent for " +
        repoRoot,
      preservedUserIntent: true,
    };
  }

  // Already converged.
  if (existingBlock && existingBlock.enabled === true) {
    return {
      writes: [],
      deletes: [],
      rationale: "Codex plugin already enabled; no write needed.",
      preservedUserIntent: false,
    };
  }

  // Need to add or upsert.
  const nextPlugins: Record<string, unknown> = { ...plugins };
  nextPlugins[DPF_PLUGIN_KEY] = { ...(existingBlock ?? {}), enabled: true };

  const nextParsed: Record<string, unknown> = { ...parsed, plugins: nextPlugins };

  const nextText = stringify(nextParsed);

  return {
    writes: [{ path: configPath, content: nextText }],
    deletes: [],
    rationale: `Upserting [plugins."${DPF_PLUGIN_KEY}"] enabled=true for ${repoRoot}.`,
    preservedUserIntent: false,
  };
}
