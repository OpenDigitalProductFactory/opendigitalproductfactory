#!/usr/bin/env node
// Session/bootstrap health check for DPF-native process-spine replacement skills.
//
// The check deliberately separates:
//   1. installed-on-disk: the dpf-platform plugin/source contains SKILL.md files;
//   2. exposed-in-session: the active client reports which skills are visible.
//
// Most clients do not expose active skill state to hooks yet. In that case the
// check warns "unknown" rather than pretending install equals loaded.
//
// Client-specific adapters that populate DPF_PROCESS_SPINE_EXPOSED_SKILLS_*
// (BI-BCA162CF): Grok has one (./grok-skill-exposure-adapter.mjs, wired from
// scripts/dpf-bootstrap-agent-toolchain.sh|.ps1 and the Python fallback
// updater's probe_grok_exposed_skills), because `grok plugin list --json` is
// a genuine non-interactive command that answers Grok's own runtime state.
// Codex, Claude, and Antigravity do NOT get one: no non-interactive
// active-skill-list API was found for any of them (Codex's `codex exec --json`
// startup events carry no plugin/skill field; Codex's config.toml plugin
// `enabled` toggle is persisted config, not a verified session state, and
// Codex separately gates hooks behind interactive trust; Antigravity's `agy`
// CLI has no discovered skill-list surface). Feeding an unverified proxy into
// this channel would flip `exposed.state` to "verified" and produce false
// confidence, which is worse than the honest "unknown" this file already
// renders -- so those clients stay documented gaps, not fabricated adapters.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultSkillPackRoot = resolve(here, "..");
const contractPath = join(defaultSkillPackRoot, "process-spine-replacements.json");

export function loadReplacementContract(skillPackRoot = defaultSkillPackRoot) {
  const raw = readFileSync(join(skillPackRoot, "process-spine-replacements.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.replacements)) {
    throw new Error("process-spine-replacements.json must contain replacements[]");
  }
  return parsed.replacements;
}

export function loadCleanupPolicy(skillPackRoot = defaultSkillPackRoot) {
  const raw = readFileSync(join(skillPackRoot, "process-spine-replacements.json"), "utf8");
  const parsed = JSON.parse(raw);
  const policy = parsed.cleanupPolicy;
  if (!policy || !Array.isArray(policy.clients)) {
    throw new Error("process-spine-replacements.json must contain cleanupPolicy.clients[]");
  }
  return policy;
}

export const REQUIRED_REPLACEMENT_SLUGS = loadReplacementContract().map((entry) => entry.dpfSkill);

function normalizeSkillId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[$@]+/, "")
    .toLowerCase();
}

function skillAliases(entry) {
  return [entry.dpfSkill, `dpf-platform:${entry.dpfSkill}`].map(normalizeSkillId);
}

function retiredAliases(entry) {
  return [entry.retiredSkill, ...(entry.retiredSurfaceIds ?? [])].map(normalizeSkillId);
}

function exposedSet(exposedSkills) {
  if (!Array.isArray(exposedSkills)) return null;
  return new Set(exposedSkills.map(normalizeSkillId).filter(Boolean));
}

function hasAnySkill(set, aliases) {
  if (!set) return false;
  return aliases.some((alias) => set.has(alias));
}

export function parseExposedSkillsFromEnv(env = process.env) {
  if (env.DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON) {
    const parsed = JSON.parse(env.DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON);
    if (!Array.isArray(parsed)) throw new Error("DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON must be an array");
    return parsed;
  }
  if (env.DPF_PROCESS_SPINE_EXPOSED_SKILLS_FILE) {
    const raw = readFileSync(env.DPF_PROCESS_SPINE_EXPOSED_SKILLS_FILE, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) return JSON.parse(trimmed);
    return trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (env.DPF_PROCESS_SPINE_EXPOSED_SKILLS) {
    return env.DPF_PROCESS_SPINE_EXPOSED_SKILLS.split(/[,\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

export function assessProcessSpine({
  skillPackRoot = defaultSkillPackRoot,
  exposedSkills = null,
} = {}) {
  const replacements = loadReplacementContract(skillPackRoot);
  const exposed = exposedSet(exposedSkills);
  const rows = replacements.map((entry) => {
    const skillPath = join(skillPackRoot, "skills", entry.dpfSkill, "SKILL.md");
    const dpfExposed = exposed ? hasAnySkill(exposed, skillAliases(entry)) : null;
    const genericExposed = exposed ? hasAnySkill(exposed, retiredAliases(entry)) : null;
    return {
      dpfSkill: entry.dpfSkill,
      retiredSkill: entry.retiredSkill,
      skillPath,
      installed: existsSync(skillPath),
      dpfExposed,
      genericExposed,
    };
  });

  const missingInstalled = rows.filter((row) => !row.installed).map((row) => row.dpfSkill);
  const missingDpfExposed = exposed
    ? rows.filter((row) => !row.dpfExposed).map((row) => row.dpfSkill)
    : [];
  const conflicts = exposed
    ? rows
        .filter((row) => row.genericExposed && !row.dpfExposed)
        .map((row) => ({
          dpfSkill: row.dpfSkill,
          retiredSkill: row.retiredSkill,
        }))
    : [];

  const exposureUnknown = exposed === null;
  const severity = missingInstalled.length > 0
    ? "fail"
    : exposureUnknown || conflicts.length > 0 || missingDpfExposed.length > 0
      ? "warn"
      : "ok";

  return {
    severity,
    replacements: rows,
    installed: {
      ok: missingInstalled.length === 0,
      total: rows.length,
      present: rows.length - missingInstalled.length,
      missingDpfSkills: missingInstalled,
    },
    exposed: exposed
      ? {
          state: "verified",
          total: rows.length,
          present: rows.length - missingDpfExposed.length,
          missingDpfSkills: missingDpfExposed,
        }
      : {
          state: "unknown",
          total: rows.length,
          present: null,
          missingDpfSkills: [],
          message: "client did not provide active skill evidence; DPF cannot prove replacements are loaded",
        },
    conflicts,
  };
}

export function renderProcessSpineSummary(verdict) {
  const lines = ["Process spine health:"];
  if (verdict.installed.ok) {
    lines.push(
      `  DPF-native replacement skills installed: OK (${verdict.installed.present}/${verdict.installed.total}).`,
    );
  } else {
    lines.push(
      `  DPF-native replacement skills installed: MISSING ${verdict.installed.missingDpfSkills.join(", ")}.`,
    );
  }

  if (verdict.exposed.state === "verified") {
    if (verdict.exposed.missingDpfSkills.length === 0) {
      lines.push(
        `  DPF-native replacement skills loaded/exposed in this session: OK (${verdict.exposed.present}/${verdict.exposed.total}).`,
      );
    } else {
      lines.push(
        `  DPF-native replacement skills loaded/exposed in this session: MISSING ${verdict.exposed.missingDpfSkills.join(", ")}.`,
      );
    }
  } else {
    lines.push(
      "  DPF-native replacement skills loaded/exposed in this session: UNKNOWN - this client did not provide active skill evidence; DPF cannot prove replacements are loaded.",
    );
  }

  if (verdict.conflicts.length > 0) {
    const pairs = verdict.conflicts
      .map((c) => `superpowers:${c.retiredSkill} without ${c.dpfSkill}`)
      .join(", ");
    lines.push(
      `  WARNING: DPF-native replacement skills are not active for visible retired generic skills: ${pairs}.`,
    );
  }

  if (verdict.severity !== "ok") {
    lines.push(
      "  Plain-language fix: restart the client after bootstrap; if the DPF replacements are still absent, repair the dpf-platform plugin exposure before project work begins.",
    );
  }
  return lines;
}

export function renderCleanupPolicySummary(policy = loadCleanupPolicy()) {
  const lines = ["Process spine cleanup/update:"];
  lines.push(
    `  Policy: ${policy.mode} - rerun bootstrap/updater after DPF skill-pack changes; safe adapters never delete user-owned skill files or plugin caches.`,
  );
  for (const client of policy.clients ?? []) {
    const label = client.client.charAt(0).toUpperCase() + client.client.slice(1);
    const ids = (client.competitivePluginIds ?? []).join(", ");
    if (client.status === "reconciles-safe-config") {
      lines.push(`  ${label}: disables known competitive plugins when found (${ids}).`);
    } else {
      lines.push(`  ${label}: ${client.status}; warns if competitive process skills are active (${ids}).`);
    }
  }
  return lines;
}

function parseArgs(argv) {
  const args = { skillPackRoot: defaultSkillPackRoot, exposedSkills: undefined, hook: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skill-pack-root") args.skillPackRoot = resolve(argv[++i]);
    else if (arg === "--exposed-skills") args.exposedSkills = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--exposed-skills-file") {
      const raw = readFileSync(argv[++i], "utf8").trim();
      args.exposedSkills = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean);
    } else if (arg === "--hook") args.hook = true;
  }
  if (args.exposedSkills === undefined) args.exposedSkills = parseExposedSkillsFromEnv();
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const verdict = assessProcessSpine({
    skillPackRoot: args.skillPackRoot,
    exposedSkills: args.exposedSkills,
  });
  const lines = [
    ...renderProcessSpineSummary(verdict),
    ...renderCleanupPolicySummary(loadCleanupPolicy(args.skillPackRoot)),
  ];

  if (args.hook) {
    if (verdict.severity === "ok") process.exit(0);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: lines.join("\n"),
        },
      }),
    );
    process.exit(0);
  }

  for (const line of lines) console.log(line);
  process.exit(verdict.severity === "fail" ? 2 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
