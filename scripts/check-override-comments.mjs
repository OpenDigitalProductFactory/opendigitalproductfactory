#!/usr/bin/env node
// Override Provenance Guard.
//
// Every SECURITY-FLOOR entry under the `overrides:` block of pnpm-workspace.yaml
// must carry a machine-readable advisory tag — `Dependabot #NN`, a full `GHSA-…`
// id, or a `CVE-…` id — in a comment directly above it (or on its own line). That
// tag is what lets the stale-override audit (BI-CDB2E8AB) cross-check whether the
// underlying alert is still open, so a floor is never silently kept forever.
//
// Non-security pins (dedup / major-version / compat) are exempt. Historical
// security floors that predate this convention are grandfathered as explicit
// backfill debt. A NEW untagged override that is not clearly a dedup/compat pin
// FAILS — that is the ratchet.
//
// Spec: docs/superpowers/specs/2026-07-21-agent-process-efficiency-hardening-design.md
// Convention introduced by PR #3357 (each floor comment names its GHSA / Dependabot #).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TAG_RE =
  /Dependabot #\d+|GHSA-[0-9a-z]{4,}-[0-9a-z]{4,}-[0-9a-z]{4,}|CVE-\d{4}-\d{4,}/i;

// Non-security pins: dedup, major-version floors, compat. Never require a tag.
const EXEMPT_DEDUP = new Set([
  "@types/react",
  "@expo/cli@0.24.24>picomatch",
  "lodash",
  "lodash-es",
  "@tootallnate/once",
  "uuid",
  "ip-address",
]);

// Documented workaround families (not CVE floors): the jest-30 unification block
// and the diagram-stack churn pins (BI-72E0A27B).
const EXEMPT_PATTERNS = [
  /^jest(-|$)/,
  /^@jest\//,
  /^babel-jest$/,
  /^expect$/,
  /^pretty-format$/,
  /^@testing-library\//,
  /^mermaid$/,
  /^@mermaid-js\//,
  /^@zenuml\//,
  /^@floating-ui\//,
];

// Security floors that predate the provenance convention. Backfill their GHSA /
// Dependabot ids via the stale-override audit (BI-CDB2E8AB). This list is CLOSED:
// a new override may NOT be added here — tag it instead.
const GRANDFATHERED_DEBT = new Set([
  "node-forge",
  "postcss",
  "@opentelemetry/otlp-transformer>protobufjs",
  "ws@>=8.0.0 <8.20.1",
]);

// Entries covered by a shared advisory comment above a sibling entry (the comment
// tags the whole contiguous run). Keyed explicitly so the sibling still counts.
const COVERED_BY_SIBLING = new Set(["minimatch@9.0.9>brace-expansion"]);

/**
 * Audit the overrides block. Pure — takes the file text, returns the list of
 * override keys that are security-shaped but carry no machine-readable provenance.
 * @param {string} text pnpm-workspace.yaml contents
 * @returns {{ untagged: string[], scanned: number }}
 */
export function auditOverrides(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^overrides:\s*$/.test(l));
  if (start === -1) throw new Error("no `overrides:` block found");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const untagged = [];
  let scanned = 0;
  let comments = [];
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      comments = [];
      continue;
    }
    if (trimmed.startsWith("#")) {
      comments.push(trimmed);
      continue;
    }
    const m = line.match(/^\s+('?)(.+?)\1\s*:\s*/);
    if (!m) {
      comments = [];
      continue;
    }
    const key = m[2].trim();
    scanned++;
    const tagged = TAG_RE.test(line) || comments.some((c) => TAG_RE.test(c));
    comments = [];
    if (tagged) continue;
    if (EXEMPT_DEDUP.has(key)) continue;
    if (GRANDFATHERED_DEBT.has(key)) continue;
    if (COVERED_BY_SIBLING.has(key)) continue;
    if (EXEMPT_PATTERNS.some((re) => re.test(key))) continue;
    untagged.push(key);
  }
  return { untagged, scanned };
}

async function main() {
  const text = await readFile("pnpm-workspace.yaml", "utf8");
  let result;
  try {
    result = auditOverrides(text);
  } catch (err) {
    console.error(`Override provenance guard: ${err.message}`);
    process.exit(1);
  }
  if (result.untagged.length > 0) {
    console.error("Override provenance guard failed — untagged security floor(s):");
    for (const key of result.untagged) {
      console.error(`  - ${key}`);
    }
    console.error(
      "\nAdd a comment naming the advisory (Dependabot #NN / GHSA-… / CVE-…) directly",
    );
    console.error(
      "above the override, or — if it is a dedup/compat pin, not a CVE floor — add it",
    );
    console.error("to EXEMPT_DEDUP in scripts/check-override-comments.mjs with a rationale.");
    process.exit(1);
  }
  console.log(
    `Override provenance guard passed — ${result.scanned} overrides scanned, all security floors carry an advisory tag.`,
  );
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
}
