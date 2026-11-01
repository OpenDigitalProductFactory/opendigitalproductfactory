#!/usr/bin/env node
// BI-64795FD0: derive everything that states a client capability from the one
// profile, packages/dpf-skill-pack/client-capabilities.json.
//
// Outputs (all byte-stable, no timestamps):
//   - packages/integration-shared/src/client-capability-profile.generated.ts,
//     the copy the credential policy, the floor and the manifest read;
//   - packages/dpf-skill-pack/scripts/mcp-credential-policy-cases.json, the
//     fixture the TypeScript and Python policies are both tested against;
//   - the generated matrix block in docs/architecture/agent-client-capability-parity.md.
//
// The profile is validated first. A profile that fails validation writes nothing.
// Registered with the derived-artifact gate (scripts/lib/derived-artifacts-registry.mjs,
// id "client-capabilities"), so a stale output fails CI.
//
// Usage:
//   node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs          # write
//   node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs --check  # fail if stale

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rules = require(join(REPO_ROOT, "packages/integration-shared/src/client-capability-rules.cjs"));

export const PROFILE_PATH = "packages/dpf-skill-pack/client-capabilities.json";
export const MODULE_PATH = "packages/integration-shared/src/client-capability-profile.generated.ts";
export const CASES_PATH = "packages/dpf-skill-pack/scripts/mcp-credential-policy-cases.json";
export const TRACKER_PATH = "docs/architecture/agent-client-capability-parity.md";
export const SELFTEST_PATH = "packages/dpf-skill-pack/hooks/pretooluse-guard-selftest.mjs";
/** The updater's offline fallback for each client's declaration carrier (DEFAULT_CARRIERS). */
export const CONVERGENCE_PATH = "packages/dpf-skill-pack/scripts/toolchain_convergence.py";

export const MATRIX_BEGIN = "<!-- BEGIN GENERATED: client-capability-matrix (node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs) -->";
export const MATRIX_END = "<!-- END GENERATED: client-capability-matrix -->";

export const STATUSES = Object.freeze(["verified", "encoded", "unproven"]);
export const HOOK_HOSTS = Object.freeze(["cli", "desktop", "ide"]);
export const HOOK_EVENTS = Object.freeze([
  "SessionStart",
  "PreToolUse:Bash",
  "PreToolUse:AskUserQuestion",
  "PreToolUse:Write|Edit|MultiEdit",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
]);
export const EVENT_STATES = Object.freeze(["fires", "not-fired", "unproven"]);
export const SCALAR_FIELDS = Object.freeze([
  "oauthHttps",
  "oauthLoopbackHttp",
  "staticHeaders",
  "declarationCarrier",
  "pluginScopes",
  "reloadRequired",
  "skillsLoad",
]);

/** The credential-policy client keys, in the fixture's order. */
export const POLICY_CLIENTS = Object.freeze(["codex", "claude", "vscode", "grok", "antigravity"]);
// What each adapter writes (BI-1DCF9F23, spec M4): the client CLI is the
// single writer of whatever it covers. scripts/single_writer_test.py runs the
// updater against fixture homes and fails on a write this list does not allow.
export const WRITE_OWNERS = Object.freeze(["dpf", "client"]);
export const WRITE_FORMATS = Object.freeze(["json", "toml", "tree", "text"]);
export const WRITE_WRITERS = Object.freeze(["direct", "cli"]);
/** The endpoints the fixture covers: https, each loopback spelling, remote http, unparseable. */
export const CASE_ENDPOINTS = Object.freeze([
  "https://dpf.example/api/mcp/v1",
  "http://127.0.0.1:3000/api/mcp/v1",
  "http://localhost:3000/api/mcp/v1",
  "http://[::1]:3000/api/mcp/v1",
  "http://remote.example/api/mcp/v1",
  "not a URL",
]);
const MODES = Object.freeze(["oauth", "legacy"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkField(problems, where, field) {
  if (!field || typeof field !== "object") return problems.push(`${where}: missing`);
  if (!STATUSES.includes(field.status)) problems.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
  if (typeof field.evidence !== "string" || !field.evidence.trim()) problems.push(`${where}: evidence is required`);
  if (field.status === "unproven" && field.value === true) problems.push(`${where}: an unproven capability cannot be true`);
  if (field.status !== "unproven" && !(typeof field.verifiedAt === "string" && DATE_RE.test(field.verifiedAt))) {
    problems.push(`${where}: verifiedAt (YYYY-MM-DD) is required unless unproven`);
  }
  if (field.verifiedVersion !== null && typeof field.verifiedVersion !== "string") problems.push(`${where}: verifiedVersion must be a string or null`);
}

function checkHookHost(problems, where, host, knownProbes) {
  if (!host || typeof host !== "object") return problems.push(`${where}: missing`);
  if (!STATUSES.includes(host.status)) problems.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
  if (typeof host.evidence !== "string" || !host.evidence.trim()) problems.push(`${where}: evidence is required`);
  if (host.status === "verified" && !(typeof host.verifiedAt === "string" && DATE_RE.test(host.verifiedAt) && host.verifiedVersion)) {
    problems.push(`${where}: a verified hook plane needs verifiedAt and verifiedVersion`);
  }
  if (host.status === "verified" && (!Array.isArray(host.permissionModes) || host.permissionModes.length === 0)) {
    problems.push(`${where}: a verified hook plane names the permission modes it was verified in`);
  }
  if (![null, "hookSpecificOutput", "dual"].includes(host.denyEnvelope)) problems.push(`${where}: denyEnvelope must be hookSpecificOutput, dual or null`);
  const events = host.events ?? {};
  for (const event of HOOK_EVENTS) {
    if (!EVENT_STATES.includes(events[event])) problems.push(`${where}.events.${event}: must be one of ${EVENT_STATES.join(", ")}`);
  }
  for (const event of Object.keys(events)) {
    if (!HOOK_EVENTS.includes(event)) problems.push(`${where}.events.${event}: unknown hook event`);
  }
  if (host.status !== "verified" && Object.values(events).some((state) => state !== "unproven")) {
    problems.push(`${where}: an unverified hook plane cannot state that an event fires or not`);
  }
  for (const probe of host.probes ?? []) {
    if (!knownProbes.has(probe)) problems.push(`${where}.probes: ${probe} is not a probe in ${SELFTEST_PATH}`);
  }
}

function checkWrites(problems, kind, row) {
  if (!row.loadsPack) return;
  if (!Array.isArray(row.writes) || row.writes.length === 0) {
    problems.push(`${kind}: writes[] must declare every file the adapter writes`);
    return;
  }
  row.writes.forEach((entry, index) => {
    const where = `${kind}.writes[${index}]`;
    if (typeof entry?.path !== "string" || !/^(~|<project>)\//.test(entry.path)) problems.push(`${where}: path must start with ~/ or <project>/`);
    if (!WRITE_OWNERS.includes(entry?.owner)) problems.push(`${where}: owner must be one of ${WRITE_OWNERS.join(", ")}`);
    if (!WRITE_FORMATS.includes(entry?.format)) problems.push(`${where}: format must be one of ${WRITE_FORMATS.join(", ")}`);
    if (!WRITE_WRITERS.includes(entry?.writer)) problems.push(`${where}: writer must be one of ${WRITE_WRITERS.join(", ")}`);
    if (entry?.writer === "cli" && (typeof entry.cli !== "string" || !entry.cli)) problems.push(`${where}: a cli writer must name the CLI`);
    if (entry?.writer === "direct" && entry.cli !== null) problems.push(`${where}: a direct writer names no CLI; set writer "cli" when one covers the file`);
    if (typeof entry?.reason !== "string" || !entry.reason) problems.push(`${where}: reason is required`);
  });
}

/** Every problem with the profile; empty when it is valid. */
export function validateProfile(profile, { knownProbes = new Set() } = {}) {
  const problems = [];
  if (profile?.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  const clients = profile?.clients ?? {};
  const policyClients = Object.values(clients).map((row) => row?.policyClient);
  for (const client of POLICY_CLIENTS) {
    if (policyClients.filter((value) => value === client).length !== 1) problems.push(`exactly one row must have policyClient "${client}"`);
  }
  for (const [kind, row] of Object.entries(clients)) {
    if (!POLICY_CLIENTS.includes(row.policyClient)) problems.push(`${kind}: unknown policyClient "${row.policyClient}"`);
    if (typeof row.displayName !== "string" || !row.displayName) problems.push(`${kind}: displayName is required`);
    if (typeof row.loadsPack !== "boolean") problems.push(`${kind}: loadsPack must be a boolean`);
    if (row.verifiedVersion !== null && typeof row.verifiedVersion !== "string") problems.push(`${kind}: verifiedVersion must be a string or null`);
    if (row.verifiedVersion && row.verifiedRange?.max !== row.verifiedVersion) problems.push(`${kind}: verifiedRange.max must equal verifiedVersion`);
    if (!row.verifiedVersion && row.verifiedRange !== null) problems.push(`${kind}: verifiedRange must be null when nothing is verified`);
    if (!Array.isArray(row.sources) || row.sources.length === 0) problems.push(`${kind}: sources[] needs at least one official URL`);
    for (const source of row.sources ?? []) {
      if (!/^https:\/\/[^\s]+$/.test(source)) problems.push(`${kind}: source "${source}" must be an https URL`);
    }
    for (const field of SCALAR_FIELDS) checkField(problems, `${kind}.${field}`, row.capabilities?.[field]);
    for (const host of HOOK_HOSTS) checkHookHost(problems, `${kind}.hookPlane.${host}`, row.capabilities?.hookPlane?.[host], knownProbes);
    checkWrites(problems, kind, row);
  }
  return problems;
}

/** The guard names the SessionStart self-test probes (one harmless input each guard must deny). */
export function readSelftestProbes(text) {
  return new Set([...String(text).matchAll(/guard:\s*"([^"]+)"/g)].map((match) => match[1]));
}

/** The updater's DEFAULT_CARRIERS dict, read from its Python source. */
export function readUpdaterCarriers(pythonText) {
  const match = /^DEFAULT_CARRIERS\s*=\s*(\{[^}\n]*\})\s*$/m.exec(String(pythonText));
  if (!match) throw new Error(`${CONVERGENCE_PATH} has no one-line DEFAULT_CARRIERS dict`);
  return JSON.parse(match[1]);
}

/**
 * Every disagreement between the profile's declarationCarrier and the updater's
 * DEFAULT_CARRIERS. The manifest's DECLARATION_CARRIERS reads the profile, so
 * agreement here keeps all three in step.
 */
export function carrierDrift(profile, updaterCarriers) {
  const problems = [];
  const packClients = Object.entries(profile.clients ?? {}).filter(([, row]) => row.loadsPack);
  for (const [kind, row] of packClients) {
    const value = row.capabilities?.declarationCarrier?.value ?? null;
    if (updaterCarriers[kind] !== value) problems.push(`${kind}: profile declarationCarrier ${value} but ${CONVERGENCE_PATH} DEFAULT_CARRIERS says ${updaterCarriers[kind] ?? "nothing"}`);
  }
  for (const kind of Object.keys(updaterCarriers)) {
    if (!packClients.some(([name]) => name === kind)) problems.push(`${kind}: in DEFAULT_CARRIERS but not a pack-loading profile row`);
  }
  return problems;
}

/** The policy fixture, in the exact format the Python and TypeScript tests read. */
export function renderPolicyCases(profile) {
  const lines = [];
  for (const endpoint of CASE_ENDPOINTS) {
    for (const client of POLICY_CLIENTS) {
      for (const mode of MODES) {
        const required = rules.bearerHeaderRequiredFor(profile, endpoint, client, mode);
        lines.push(`  {"endpoint": ${JSON.stringify(endpoint)}, "client": ${JSON.stringify(client)}, "mode": ${JSON.stringify(mode)}, "required": ${required}}`);
      }
    }
  }
  return `[\n${lines.join(",\n")}\n]\n`;
}

/** The TypeScript copy of the profile that runtime rules import. */
export function renderProfileModule(profile) {
  // `writes` is the Python updater's single-writer contract; no TypeScript
  // rule reads it, so the portal module carries the capabilities only.
  const clients = Object.fromEntries(Object.entries(profile.clients).map(([kind, { writes, ...row }]) => [kind, row]));
  const data = { schemaVersion: profile.schemaVersion, clients };
  return `// GENERATED FILE — do not edit. Source: ${PROFILE_PATH}
// Regenerate: node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs (BI-64795FD0)

import type { ClientCapabilityProfile } from "./client-capability-rules.cjs";

export const CLIENT_CAPABILITY_PROFILE: ClientCapabilityProfile = ${JSON.stringify(data, null, 2)};
`;
}

function cell(field) {
  if (!field || field.status === "unproven") return "unproven";
  const value = Array.isArray(field.value) ? field.value.join(", ") : field.value === true ? "yes" : field.value === false ? "no" : String(field.value);
  const when = field.verifiedVersion ? `${field.verifiedAt}, v${field.verifiedVersion}` : field.verifiedAt;
  return field.status === "verified" ? `${value} (verified ${when})` : `${value} (encoded, not live-proven)`;
}

const EVENT_LABELS = {
  SessionStart: "SessionStart",
  "PreToolUse:Bash": "PreToolUse shell",
  "PreToolUse:AskUserQuestion": "PreToolUse ask",
  "PreToolUse:Write|Edit|MultiEdit": "PreToolUse write",
  UserPromptSubmit: "UserPromptSubmit",
  Stop: "Stop",
  SessionEnd: "SessionEnd",
};

function hookSummary(row) {
  return HOOK_HOSTS.map((host) => `${host}: ${row.capabilities.hookPlane[host].status === "verified" ? "verified" : "hooks unproven"}`).join("; ");
}

function eventsCell(host) {
  if (host.status !== "verified") return "hooks unproven";
  const by = (state) => HOOK_EVENTS.filter((event) => host.events[event] === state).map((event) => EVENT_LABELS[event]);
  const parts = [];
  if (by("fires").length) parts.push(`fires: ${by("fires").join(", ")}`);
  if (by("not-fired").length) parts.push(`does not fire: ${by("not-fired").join(", ")}`);
  if (by("unproven").length) parts.push(`unproven: ${by("unproven").join(", ")}`);
  return parts.join("; ");
}

// Backslashes first, so an escaped pipe in the input cannot end the cell.
const escapeCell = (text) => String(text ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The rendered matrix block, auth gaps and hook gaps side by side. */
export function renderMatrix(profile) {
  const rows = Object.entries(profile.clients);
  const out = [
    MATRIX_BEGIN,
    "",
    `Rendered from [\`${PROFILE_PATH}\`](../../${PROFILE_PATH}). Edit the profile, never this block. "unproven" means no live probe is recorded, so every rule treats the capability as absent. Server-side controls stay the guarantee; a missing hook is a missing accelerator, shown here so it is not silent.`,
    "",
    "| Client | Verified version | OAuth https | OAuth loopback http | Static headers | Declaration carrier | Plugin scopes | Reload required | Skills load | Hook plane |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [kind, row] of rows) {
    const c = row.capabilities;
    out.push(`| ${escapeCell(`${row.displayName} (\`${kind}\`)`)} | ${row.verifiedVersion ?? "none"} | ${escapeCell(cell(c.oauthHttps))} | ${escapeCell(cell(c.oauthLoopbackHttp))} | ${escapeCell(cell(c.staticHeaders))} | ${escapeCell(cell(c.declarationCarrier))} | ${escapeCell(cell(c.pluginScopes))} | ${escapeCell(cell(c.reloadRequired))} | ${escapeCell(cell(c.skillsLoad))} | ${escapeCell(hookSummary(row))} |`);
  }
  out.push("", "**Hook plane by host.**", "", "| Client | Host | Events | Deny envelope | Permission modes | Verified | Evidence |", "|---|---|---|---|---|---|---|");
  for (const [kind, row] of rows) {
    for (const hostName of HOOK_HOSTS) {
      const host = row.capabilities.hookPlane[hostName];
      const verified = host.status === "verified" ? `${host.verifiedAt}, v${host.verifiedVersion}` : "no";
      out.push(`| \`${kind}\` | ${hostName} | ${escapeCell(eventsCell(host))} | ${host.denyEnvelope ?? "unknown"} | ${escapeCell(host.permissionModes.join(", ") || "none")} | ${verified} | ${escapeCell(host.evidence)} |`);
    }
  }
  out.push("", MATRIX_END);
  return out.join("\n");
}

/** Replace the generated block in the tracker; throws when the markers are missing. */
export function spliceMatrix(trackerText, matrix) {
  const start = trackerText.indexOf(MATRIX_BEGIN);
  const end = trackerText.indexOf(MATRIX_END);
  if (start < 0 || end < start) throw new Error(`${TRACKER_PATH} has no generated client-capability-matrix markers`);
  return trackerText.slice(0, start) + matrix + trackerText.slice(end + MATRIX_END.length);
}

/** Every output path with its expected content. Throws when the profile is invalid. */
export function generateOutputs(root = REPO_ROOT) {
  const profile = JSON.parse(readFileSync(join(root, PROFILE_PATH), "utf8"));
  const knownProbes = readSelftestProbes(readFileSync(join(root, SELFTEST_PATH), "utf8"));
  const problems = [
    ...validateProfile(profile, { knownProbes }),
    ...carrierDrift(profile, readUpdaterCarriers(readFileSync(join(root, CONVERGENCE_PATH), "utf8"))),
  ];
  if (problems.length) throw new Error(`${PROFILE_PATH} is invalid:\n  - ${problems.join("\n  - ")}`);
  const tracker = readFileSync(join(root, TRACKER_PATH), "utf8").replace(/\r\n/g, "\n");
  return new Map([
    [MODULE_PATH, renderProfileModule(profile)],
    [CASES_PATH, renderPolicyCases(profile)],
    [TRACKER_PATH, spliceMatrix(tracker, renderMatrix(profile))],
  ]);
}

/** Paths whose committed content differs from what the profile generates. */
export function staleOutputs(root = REPO_ROOT) {
  const stale = [];
  for (const [path, expected] of generateOutputs(root)) {
    let current = null;
    try {
      current = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
    } catch { /* missing counts as stale */ }
    if (current !== expected) stale.push(path);
  }
  return stale;
}

function main() {
  if (process.argv.includes("--check")) {
    const stale = staleOutputs();
    if (stale.length) {
      console.error(`[client-capabilities] STALE — ${stale.join(", ")} do not match ${PROFILE_PATH}.`);
      console.error("Regenerate and commit: node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs");
      process.exit(1);
    }
    console.log("[client-capabilities] fresh.");
    return;
  }
  for (const [path, content] of generateOutputs()) writeFileSync(join(REPO_ROOT, path), content);
  console.log(`[client-capabilities] wrote ${MODULE_PATH}, ${CASES_PATH}, ${TRACKER_PATH}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`[client-capabilities] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
