#!/usr/bin/env node
// Grok active-skill exposure adapter (BI-BCA162CF).
//
// process-spine-health-check.mjs deliberately separates "installed on disk"
// from "exposed in the active client session", and reports the latter as
// UNKNOWN unless a client provides evidence via DPF_PROCESS_SPINE_EXPOSED_
// SKILLS_JSON/FILE/plain. Most external clients have no such non-interactive
// API. Grok does: `grok plugin list --json` is a genuine, already-used-in-
// this-codebase command (update_agent_toolchain.py's install_grok_plugin
// already shells out to it to detect an existing dpf-platform install). It is
// Grok's OWN plugin registry answering "what do you currently recognize",
// which is materially stronger evidence than checking whether a SKILL.md file
// exists in DPF's managed copy on disk.
//
// Fidelity note: Grok's plugin-list JSON schema is not publicly pinned beyond
// the `name` field this codebase already depends on. This adapter therefore
// only relies on `name` presence for the exposure signal, and honors an
// `enabled` field defensively (never required) if the client happens to emit
// one. It also cannot distinguish per-skill toggles: Grok reports at
// PLUGIN granularity, and process-spine-replacements.json's five DPF
// replacement skills all ship inside the single `dpf-platform` plugin while
// the retired-generic identifiers all ship inside the `superpowers`-family
// plugins tracked in process-spine-replacements.json's cleanupPolicy — so
// plugin-level presence maps cleanly onto the skill-level question the health
// checker asks.
//
// Codex and Antigravity do NOT get an adapter here: research for this BI
// found no non-interactive Codex command that lists actively loaded skills
// (`codex exec --json` startup events carry no plugin/skill field per
// docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md), and
// Antigravity's `agy` CLI has no discoverable non-interactive skill-list
// mechanism at all (see the "Known Limit" section this BI added to
// docs/superpowers/specs/2026-07-19-process-spine-skill-exposure-health-design.md).
// Guessing at an API that may not exist would produce a false "verified"
// exposure state, which is worse than the honest "unknown" the health checker
// already renders — so those clients remain documented gaps, not fabricated
// adapters.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCleanupPolicy, loadReplacementContract } from "./process-spine-health-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultSkillPackRoot = resolve(here, "..");

export const DPF_PLUGIN_NAME = "dpf-platform";

function normalizeSkillId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[$@]+/, "")
    .toLowerCase();
}

/** Parse the JSON array `grok plugin list --json` prints on stdout. */
export function parseGrokPluginListOutput(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) throw new Error("grok plugin list --json must print a JSON array");
  return parsed;
}

/**
 * True when `plugins` (the `grok plugin list --json` shape) names `pluginId`
 * and does not explicitly report it disabled.
 */
export function grokPluginActive(plugins, pluginId) {
  const entry = (plugins ?? []).find((p) => p && typeof p === "object" && p.name === pluginId);
  if (!entry) return false;
  return entry.enabled !== false;
}

/** Resolve the grok-specific competitive plugin ids from the shared contract. */
export function grokCompetitivePluginIds(skillPackRoot = defaultSkillPackRoot) {
  const policy = loadCleanupPolicy(skillPackRoot);
  const client = (policy.clients ?? []).find((c) => c.client === "grok");
  return client?.competitivePluginIds ?? [];
}

/**
 * Derive the exposed-skill-id list the process-spine health checker expects,
 * from a parsed `grok plugin list --json` array.
 */
export function deriveExposedSkillsFromGrokPlugins(
  plugins,
  { replacements, competitivePluginIds } = {},
) {
  const reps = replacements ?? loadReplacementContract();
  const exposed = new Set();

  if (grokPluginActive(plugins, DPF_PLUGIN_NAME)) {
    for (const entry of reps) {
      exposed.add(normalizeSkillId(entry.dpfSkill));
      exposed.add(normalizeSkillId(`dpf-platform:${entry.dpfSkill}`));
    }
  }

  const competitors = competitivePluginIds ?? [];
  const anyCompetitorActive = competitors.some((id) => grokPluginActive(plugins, id));
  if (anyCompetitorActive) {
    for (const entry of reps) {
      exposed.add(normalizeSkillId(entry.retiredSkill));
      for (const alias of entry.retiredSurfaceIds ?? []) exposed.add(normalizeSkillId(alias));
    }
  }

  return [...exposed].filter(Boolean).sort();
}

/**
 * Run `grok plugin list --json` and derive the exposed skill ids.
 *
 * Returns `null` when Grok is not present, the command fails, or its output
 * cannot be parsed — callers must NOT set DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON
 * on a failed probe. An unset/unknown evidence channel is safer than a
 * wrongly-empty "verified" list, which would make the health checker report
 * every DPF replacement skill as missing when the truth is just "couldn't ask".
 */
export function probeGrokExposedSkills({
  skillPackRoot = defaultSkillPackRoot,
  grokBin = "grok",
  spawn = spawnSync,
} = {}) {
  let result;
  try {
    result = spawn(grokBin, ["plugin", "list", "--json"], { encoding: "utf8" });
  } catch {
    return null;
  }
  if (!result || result.error || result.status !== 0) return null;

  let plugins;
  try {
    plugins = parseGrokPluginListOutput(result.stdout);
  } catch {
    return null;
  }

  return deriveExposedSkillsFromGrokPlugins(plugins, {
    replacements: loadReplacementContract(skillPackRoot),
    competitivePluginIds: grokCompetitivePluginIds(skillPackRoot),
  });
}

function parseArgs(argv) {
  const args = { skillPackRoot: defaultSkillPackRoot, grokBin: "grok" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skill-pack-root") args.skillPackRoot = resolve(argv[++i]);
    else if (arg === "--grok-bin") args.grokBin = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const exposed = probeGrokExposedSkills(args);
  if (exposed === null) {
    process.stderr.write(
      "grok-skill-exposure-adapter: `grok plugin list --json` unavailable; leaving exposure unknown.\n",
    );
    process.exit(3);
  }
  process.stdout.write(JSON.stringify(exposed));
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
