#!/usr/bin/env node
// scripts/check-no-unreachable-room-links.mjs — a room is reachable by construction
// (BI-00727E59). See scripts/lib/room-addressing-detect.mjs for why.
//
// This guard reads LIVE REPOSITORY STATE, so its self-test must be carried as a
// conformanceTest(...) command — see scripts/check-guard-conformance-marks.mjs.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

import {
  findHandBuiltCaseKeys,
  findUnreachablePaths,
  normalizeRoomGuardPath,
} from "./lib/room-addressing-detect.mjs";

const REPO = process.cwd();
const APP_ROOT = join(REPO, "apps/web/app");
const SCAN_ROOTS = ["apps/web/lib", "apps/web/components", "apps/web/app"];
const SKIP = /node_modules|\.next|\.test\.|\.spec\.|__fixtures__/;

function buildRouteTree(root) {
  const tree = {};
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const children = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    tree[normalizeRoomGuardPath(dir)] = children;
    for (const child of children) walk(join(dir, child));
  };
  walk(root);
  return tree;
}

function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (SKIP.test(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out;
}

// Rule 2 carries a baseline, the way module-size and prose-lint do. The rule is
// enforced from today forward; the entries below are pre-existing links whose
// prefix cannot accept a dynamic segment, recorded so the class cannot GROW
// while each one is judged on its own. The baseline file carries its own owner
// and expiry, which is what forces that judgement. Rule 1 has no
// baseline: a hand-built work-case path is always wrong.
const BASELINE_PATH = join(REPO, "scripts/room-addressing-baseline.json");
const UPDATE = process.argv.includes("--update");
const readBaseline = () => {
  try {
    return new Set(JSON.parse(readFileSync(BASELINE_PATH, "utf8")).unreachableLinks ?? []);
  } catch {
    return new Set();
  }
};

const tree = buildRouteTree(APP_ROOT);

// A guard that scans nothing must not report that nothing is wrong. Both walks
// above swallow a missing directory, so running from the wrong working
// directory — or against a tree that has not finished checking out — produced
// "Room addressing OK (0 route dirs scanned)". Worse, the empty result then
// made every baseline entry look stale, and the remedy the guard printed
// (`--update`) rewrote the file with zero entries, deleting four grandfathered
// exemptions that were never judged. Silence is not a pass (BI-AB8FD9B9).
if (Object.keys(tree).length === 0) {
  console.error(`Room addressing — cannot run: no App Router tree under ${APP_ROOT}.`);
  console.error("Run this guard from the repository root; it resolves its scan roots from the");
  console.error("working directory. An empty scan cannot tell 'nothing to check' from 'nothing wrong'.");
  process.exit(2);
}

const violations = [];
let filesScanned = 0;

for (const scanRoot of SCAN_ROOTS) {
  const files = sourceFiles(join(REPO, scanRoot));
  if (files.length === 0) {
    console.error(`Room addressing — cannot run: scan root ${scanRoot} holds no source files.`);
    process.exit(2);
  }
  filesScanned += files.length;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("${")) continue;
    for (const hit of [
      ...findHandBuiltCaseKeys(source),
      ...findUnreachablePaths(source, tree, normalizeRoomGuardPath(APP_ROOT)),
    ]) {
      violations.push({ file: normalizeRoomGuardPath(relative(REPO, file)), ...hit });
    }
  }
}

const baseline = readBaseline();
const keyOf = (v) => `${v.file}::${v.prefix}`;

if (UPDATE) {
  const keys = [...new Set(violations.filter((v) => v.kind === "unreachable-path").map(keyOf))].sort();
  // Shrink-only is the rule, but "shrink to nothing" is almost always a broken
  // scan rather than four links fixed at once. Dropping every entry silently
  // discards exemptions that each still owe a judgement, so it must be asked
  // for twice (BI-AB8FD9B9).
  const existing = readBaseline();
  if (keys.length === 0 && existing.size > 0 && !process.argv.includes("--allow-empty")) {
    console.error(`Room addressing — refusing to write an EMPTY baseline over ${existing.size} recorded entr(ies).`);
    console.error("Every recorded link would be dropped, and each is a grandfathered exemption that");
    console.error("still owes its own judgement. This is what a scan that found nothing looks like,");
    console.error("so check the working directory first. If they really are all fixed, say so:");
    console.error("  node scripts/check-no-unreachable-room-links.mjs --update --allow-empty");
    process.exit(2);
  }
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    } catch {
      return {};
    }
  })();
  const payload = {
    version: 1,
    owner: previous.owner ?? "platform-architecture",
    expiry: previous.expiry ?? "2026-12-07",
    note: "Room-addressing Rule 2 baseline (BI-00727E59). Shrink-only: each entry is a link whose route prefix cannot accept a dynamic segment, recorded so the class cannot grow while each is judged on its own. Regenerate with: node scripts/check-no-unreachable-room-links.mjs --update",
    unreachableLinks: keys,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote room-addressing baseline: ${keys.length} recorded link(s).`);
  process.exit(0);
}

const stale = [...baseline].filter(
  (key) => !violations.some((v) => v.kind === "unreachable-path" && keyOf(v) === key),
);
const unbaselined = violations.filter(
  (v) => v.kind === "hand-built-case-key" || !baseline.has(keyOf(v)),
);

if (stale.length > 0) {
  console.error("Room addressing — baseline entries no longer present; retighten with --update:\n");
  for (const key of stale) console.error(`  - ${key}`);
  process.exit(1);
}

const remaining = unbaselined;
if (remaining.length > 0) {
  console.error("Room addressing — a room must be reachable by construction (BI-00727E59).\n");
  for (const v of remaining) {
    if (v.kind === "hand-built-case-key") {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    a work-case path is spelled out: \`${v.prefix}\${${v.expression}}\``);
      console.error("    compose it with encodeWorkCaseKey() — one home for the room address.\n");
    } else {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    \`${v.prefix}\${...}\` can never resolve: ${v.prefix} names a route`);
      console.error("    directory with no dynamic segment, so every such URL 404s.\n");
    }
  }
  console.error("This is the class behind BI-6F2CC21B, BI-EBEB77E2 and BI-97B24FB5: a room");
  console.error("that exists but cannot be opened, shipped because nothing asserted the link.");
  process.exit(1);
}

console.log(`Room addressing OK — no hand-built work-case paths, no provably-unreachable room links (${Object.keys(tree).length} route dirs, ${filesScanned} source files scanned). guard passed`);
