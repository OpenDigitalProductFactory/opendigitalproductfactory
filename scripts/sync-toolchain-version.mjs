#!/usr/bin/env node
// scripts/sync-toolchain-version.mjs
//
// One home for the dpf-platform pack version (BI-52934B3E, design
// docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md
// §5.1). `packages/dpf-skill-pack/toolchain-version.json` holds it; every
// per-client plugin manifest and both marketplace entries are generated from
// it. Before this, the same string was hand-kept in six places and the
// marketplace metadata still read 0.1.0.
//
// The Codex manifest keeps its `+codex.<digest>` cache suffix: the updater
// computes that per delivered content, so only the base version is ours.
//
// Usage:
//   node scripts/sync-toolchain-version.mjs           # rewrite drifted files
//   node scripts/sync-toolchain-version.mjs --check   # exit 1 on any drift
//
// Edits are textual (only the version value changes), so file formatting and
// key order are preserved and a rerun on synced files is a no-op.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryModule } from "./lib/entry-module.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "packages/dpf-skill-pack/toolchain-version.json";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Each target names a file and how to find the version string(s) in it.
 * `path` walks the parsed JSON so a missing key is reported, never silently
 * skipped. `keepSuffix` preserves a `+suffix` after the base version.
 */
export const TARGETS = Object.freeze([
  { file: "packages/dpf-skill-pack/.claude-plugin/plugin.json", path: ["version"] },
  { file: "packages/dpf-skill-pack/.grok-plugin/plugin.json", path: ["version"] },
  { file: "packages/dpf-skill-pack/.antigravity-plugin/plugin.json", path: ["version"] },
  { file: "packages/dpf-skill-pack/.codex-plugin/plugin.json", path: ["version"], keepSuffix: true },
  { file: ".claude-plugin/marketplace.json", path: ["metadata", "version"] },
  { file: ".claude-plugin/marketplace.json", path: ["plugins", { name: "dpf-platform" }, "version"] },
]);

export function readPackVersion(root = REPO_ROOT) {
  const source = JSON.parse(readFileSync(join(root, SOURCE), "utf8"));
  const version = source?.packVersion;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`${SOURCE}: packVersion must be MAJOR.MINOR.PATCH, got ${JSON.stringify(version)}`);
  }
  return version;
}

function locate(json, path) {
  let node = json;
  for (const step of path) {
    if (node === undefined || node === null) return undefined;
    if (typeof step === "object") {
      if (!Array.isArray(node)) return undefined;
      node = node.find((entry) => Object.entries(step).every(([key, value]) => entry?.[key] === value));
    } else {
      node = node[step];
    }
  }
  return node;
}

/** The version string each target must hold for `packVersion`. */
export function expectedValue(current, packVersion, keepSuffix) {
  if (!keepSuffix || typeof current !== "string") return packVersion;
  const plus = current.indexOf("+");
  return plus === -1 ? packVersion : `${packVersion}${current.slice(plus)}`;
}

/**
 * Replace exactly one `"version": "<current>"` occurrence with the expected
 * value. Several targets can share a file, so the occurrence is chosen by its
 * position among the file's `"version"` keys in document order.
 */
function rewriteVersion(text, current, next, occurrence) {
  const pattern = /("version"\s*:\s*")([^"]*)(")/g;
  let index = 0;
  return text.replace(pattern, (match, open, value, close) => {
    const hit = index === occurrence && value === current;
    index += 1;
    return hit ? `${open}${next}${close}` : match;
  });
}

function versionOccurrence(text, path, json) {
  // Document order of `"version"` keys matches JSON.parse traversal for these
  // small manifests; find which occurrence holds the located value.
  const values = [...text.matchAll(/"version"\s*:\s*"([^"]*)"/g)].map((match) => match[1]);
  const located = locate(json, path);
  const candidates = values.map((value, idx) => (value === located ? idx : -1)).filter((idx) => idx !== -1);
  if (candidates.length === 1) return candidates[0];
  // Ambiguous (equal values): fall back to the path's nesting — metadata comes first.
  return path[0] === "metadata" ? candidates[0] : candidates.at(-1);
}

/** Compute drift for every target; `write` applies the fix. */
export function syncToolchainVersion({ root = REPO_ROOT, write = false } = {}) {
  const packVersion = readPackVersion(root);
  const drift = [];
  const texts = new Map();
  for (const target of TARGETS) {
    const file = join(root, target.file);
    const text = texts.get(file) ?? readFileSync(file, "utf8");
    const json = JSON.parse(text.replace(/^﻿/, ""));
    const current = locate(json, target.path);
    if (typeof current !== "string") {
      drift.push({ file: target.file, path: target.path, current: null, expected: packVersion, error: "missing" });
      texts.set(file, text);
      continue;
    }
    const expected = expectedValue(current, packVersion, target.keepSuffix);
    if (current !== expected) {
      drift.push({ file: target.file, path: target.path, current, expected });
      texts.set(file, rewriteVersion(text, current, expected, versionOccurrence(text, target.path, json)));
    } else {
      texts.set(file, text);
    }
  }
  if (write) {
    for (const entry of drift) {
      if (entry.error) throw new Error(`${entry.file}: no version at ${JSON.stringify(entry.path)}`);
    }
    for (const [file, text] of texts) writeFileSync(file, text);
  }
  return { packVersion, drift };
}

if (isEntryModule(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { packVersion, drift } = syncToolchainVersion({ write: !check });
  if (drift.length === 0) {
    console.log(`toolchain version ${packVersion}: every manifest in sync.`);
  } else if (check) {
    console.error(`toolchain version ${packVersion} is the single source (${SOURCE}); these drifted:`);
    for (const entry of drift) {
      console.error(`  - ${entry.file} ${JSON.stringify(entry.path)}: ${entry.current ?? "missing"} (expected ${entry.expected})`);
    }
    console.error("Fix: node scripts/sync-toolchain-version.mjs");
    process.exit(1);
  } else {
    for (const entry of drift) console.log(`synced ${entry.file}: ${entry.current} -> ${entry.expected}`);
  }
}
