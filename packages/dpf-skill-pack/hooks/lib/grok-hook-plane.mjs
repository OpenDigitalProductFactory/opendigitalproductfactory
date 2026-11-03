#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/lib/grok-hook-plane.mjs
//
// Grok's dpf-guards.json, built from hooks.json minus the Grok exclusions in
// client-hook-planes.json (BI-742D707B, BI-413882E5).
//
// Grok ignores plugin-bundled hooks (BI-883FC2FC), so DPF writes a global hook
// file for it. On a host, update_agent_toolchain.py::build_grok_hooks_payload
// writes it. The Build Studio sandbox is node:24-alpine with no Python, so the
// dispatch seed (apps/web/lib/build/sandbox/grok-governance-seed.ts) runs this
// file against the workspace pack instead. It used to keep its own six-guard
// list with no matchers. Both generators read the same two files, and
// update_agent_toolchain_test.py pins their output equal.
//
// Usage: node grok-hook-plane.mjs <skill-pack-root> <hooks-dir> [--out <file>]
// Prints the payload as JSON, or with --out writes it atomically (temp file +
// rename, parent created) and prints "WIRED <n>". <hooks-dir> is where the
// hook scripts live on the machine that runs Grok.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}/hooks/";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function scriptName(command) {
  return /([A-Za-z0-9_.-]+\.mjs)/.exec(command ?? "")?.[1] ?? null;
}

/** Every hooks.json entry in definition order. */
export function hooksJsonEntries(hooksJson) {
  const entries = [];
  for (const [event, groups] of Object.entries(hooksJson.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        entries.push({ event, matcher: String(group.matcher ?? ""), script: scriptName(String(hook.command ?? "")), hook });
      }
    }
  }
  return entries;
}

/** The client's plane with any `sameAs` resolved. */
export function clientPlane(planes, client) {
  const plane = planes.clients[client];
  if (!plane?.sameAs) return plane;
  const { sameAs, ...own } = plane;
  return { ...planes.clients[sameAs], ...own };
}

/** One row per hooks.json entry: wired, bundled or excluded. Mirrors client_hook_coverage. */
export function clientHookCoverage(hooksJson, planes, client) {
  const plane = clientPlane(planes, client);
  const excluded = plane.excluded ?? {};
  const replaced = new Map();
  for (const [substitute, spec] of Object.entries(plane.bundled ?? {})) {
    for (const script of spec.replaces) replaced.set(`${spec.event}:${script}`, { substitute, spec });
  }
  return hooksJsonEntries(hooksJson).map(({ event, matcher, script }) => {
    const row = { event, matcher, script };
    const reason = excluded[`${event}:${script}`] || excluded[`${event}:*`] || plane.excludedAll;
    if (reason) return { ...row, state: "excluded", reason };
    const bundled = replaced.get(`${event}:${script}`);
    if (bundled) {
      return { ...row, state: "bundled", substitute: bundled.substitute, reason: `Runs inside ${bundled.substitute}. ${bundled.spec.reason}`, purpose: bundled.spec.purpose ?? null };
    }
    return { ...row, state: plane.plane ? "wired" : "unaccounted" };
  });
}

/** The dpf-guards.json payload. Mirrors build_grok_hooks_payload(dry_run=True). */
export function buildGrokHooksPayload({ hooksJson, planes, hooksDir, client = "grok" }) {
  const plane = clientPlane(planes, client);
  const aliases = plane.matchers ?? {};
  const timeouts = plane.timeouts ?? {};
  const hooksByEntry = new Map(hooksJsonEntries(hooksJson).map((e) => [`${e.event}\u0000${e.matcher}\u0000${e.script}`, e.hook]));
  const payload = { hooks: {} };
  const placed = new Set();
  for (const row of clientHookCoverage(hooksJson, planes, client)) {
    const timeout = Number(timeouts[row.event] ?? 15);
    let hook;
    if (row.state === "wired") {
      const source = hooksByEntry.get(`${row.event}\u0000${row.matcher}\u0000${row.script}`);
      const command = String(source.command ?? "").replace(`${PLUGIN_ROOT_TOKEN}${row.script}`, join(hooksDir, row.script));
      hook = { type: "command", command, timeout };
      if (source.statusMessage) hook.statusMessage = source.statusMessage;
    } else if (row.state === "bundled" && !placed.has(`${row.event}:${row.substitute}`)) {
      placed.add(`${row.event}:${row.substitute}`);
      hook = { type: "command", command: `node "${join(hooksDir, row.substitute)}"`, timeout };
      if (row.purpose) hook.statusMessage = row.purpose;
    } else {
      continue;
    }
    const groups = (payload.hooks[row.event] ??= []);
    if (row.matcher) {
      const matcher = aliases[row.matcher] ?? row.matcher;
      let group = groups.find((g) => g.matcher === matcher);
      if (!group) {
        group = { matcher, hooks: [] };
        groups.push(group);
      }
      group.hooks.push(hook);
    } else {
      groups.push({ hooks: [hook] });
    }
  }
  return payload;
}

/** Read hooks.json and client-hook-planes.json from a skill pack and build the payload. */
export function grokHooksPayloadForPack(skillPackRoot, hooksDir, client = "grok") {
  return buildGrokHooksPayload({
    hooksJson: readJson(join(skillPackRoot, "hooks", "hooks.json")),
    planes: readJson(join(skillPackRoot, "hooks", "client-hook-planes.json")),
    hooksDir,
    client,
  });
}

/** Write the payload atomically; returns the number of hook commands written. */
export function writeGrokHooksFile(payload, file) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, file);
  return Object.values(payload.hooks).reduce((n, groups) => n + groups.reduce((m, g) => m + g.hooks.length, 0), 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
  const [packRoot, hooksDir] = args;
  if (!packRoot || !hooksDir || (outAt >= 0 && !out)) {
    process.stderr.write("usage: node grok-hook-plane.mjs <skill-pack-root> <hooks-dir> [--out <file>]\n");
    process.exit(2);
  }
  const payload = grokHooksPayloadForPack(packRoot, hooksDir);
  if (out) process.stdout.write(`WIRED ${writeGrokHooksFile(payload, out)}\n`);
  else process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
