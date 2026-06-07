/**
 * Pinned upstream-plugin versions the DPF agent toolchain is calibrated against,
 * plus helpers that detect drift between the pinned version and what the
 * contributor's Codex CLI actually has installed.
 *
 * `superpowers` is upstream-owned (OpenAI-curated marketplace). DPF does NOT
 * auto-upgrade it — that would mutate a config block the contributor or
 * marketplace own. Instead, the bootstrap detects drift and surfaces an
 * advisory note in the install banner. The contributor (or a future
 * marketplace sync) is responsible for the actual bump.
 *
 * `dpf-platform` IS owned by this repo (`packages/dpf-skill-pack/.claude-plugin/
 * plugin.json` is the source of truth) and version drift triggers the existing
 * `mode: update` write in `planClaudePluginConfig` — no advisory needed, just
 * an upgrade write.
 */

import { parse } from "smol-toml";

/**
 * Pinned upstream-plugin versions. Bump these when re-pinning. The bootstrap
 * does not auto-pull or auto-write upstream config; drift detection is
 * advisory only.
 *
 * Sources:
 *   - `superpowers`: OpenAI's curated marketplace via Codex CLI plugin install.
 *     We pin a known-good baseline; contributors who happen to be on a newer
 *     version are noted, not downgraded.
 */
export const PINNED_UPSTREAM_VERSIONS = {
  superpowers: "0.1.0",
} as const;

export type UpstreamPluginId = keyof typeof PINNED_UPSTREAM_VERSIONS;

export type UpstreamVersionDrift = {
  plugin: UpstreamPluginId;
  pinned: string;
  observed: string | null;
  /** "match" | "different" | "missing" (not yet installed by user) */
  status: "match" | "different" | "missing";
};

/**
 * Detect superpowers version drift by inspecting the user's parsed Codex
 * config. The plugin block in `~/.codex/config.toml` looks like:
 *
 *   [plugins."superpowers@openai-curated"]
 *   enabled = true
 *   # version may or may not be recorded by Codex itself — we look for any
 *   # explicit version field as a sibling; absent means "use marketplace
 *   # default", which we treat as `null observed`.
 *
 * Pure parsing. No filesystem reads; caller supplies the TOML text.
 */
export function detectSuperpowersDrift(codexTomlText: string): UpstreamVersionDrift {
  const pinned = PINNED_UPSTREAM_VERSIONS.superpowers;
  let observed: string | null = null;
  let present = false;

  try {
    const parsed = (codexTomlText.length > 0 ? parse(codexTomlText) : {}) as Record<string, unknown>;
    const plugins = (parsed["plugins"] as Record<string, unknown> | undefined) ?? {};
    // Try the canonical OpenAI-curated id first, then fall back to other
    // marketplace suffixes (a user might be on a beta channel).
    const candidates = [
      "superpowers@openai-curated",
      "superpowers@openai-bundled",
      "superpowers",
    ];
    for (const key of candidates) {
      const block = plugins[key];
      if (block && typeof block === "object") {
        present = true;
        const v = (block as { version?: unknown }).version;
        if (typeof v === "string") {
          observed = v;
        }
        break;
      }
    }
  } catch {
    // Unparseable TOML → no drift signal we can act on. Treat as missing.
    return { plugin: "superpowers", pinned, observed: null, status: "missing" };
  }

  if (!present) {
    return { plugin: "superpowers", pinned, observed: null, status: "missing" };
  }
  if (observed === null) {
    // Plugin block exists but no version pinned by the user; assume marketplace
    // default and treat as a match (operator hasn't asked for anything else).
    return { plugin: "superpowers", pinned, observed: null, status: "match" };
  }
  return {
    plugin: "superpowers",
    pinned,
    observed,
    status: observed === pinned ? "match" : "different",
  };
}

/**
 * Render a short advisory line for the install banner when drift is detected.
 * Returns `null` when no advisory is warranted (match or missing).
 *
 * UX contract: this is a sub-line under the primary readiness state, never
 * the primary state itself. Drift does not block the bootstrap.
 */
export function renderUpstreamDriftAdvisory(drift: UpstreamVersionDrift): string | null {
  if (drift.status === "different" && drift.observed) {
    return `superpowers ${drift.observed} differs from DPF pin ${drift.pinned} (advisory; no action taken).`;
  }
  return null;
}
