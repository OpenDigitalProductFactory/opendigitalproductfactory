#!/usr/bin/env node
// scripts/check-edge-node-image-bom.mjs — BI-4B381171.
//
// Makes the edge-footprint spec's "the edge install doesn't need everything
// the portal has" claim (docs/superpowers/specs/
// 2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md
// §6 "Minimal Edge Footprint (G3)", §11.2 verification matrix) into a CI
// gate instead of a doc-only assertion. Covers the fingerprints that are
// checkable statically, without a real host, sudo, or iptables:
//
//   FP1 (static half) — no inbound listener in either edge runtime.
//     The dynamic half (zero off-allow-list egress packets on a real host)
//     is scripts/verify-edge-node-air-gap.sh; that harness needs root +
//     iptables + a live network, so it is NOT a CI job — this script is
//     the CI-runnable complement.
//   FP2 — no relational/graph/vector store client in the dependency tree
//     of either edge runtime (state is state.json only).
//   FP3 — no LLM/model-runtime SDK in the dependency tree, and no
//     hardcoded reference to a model-provider API key env var.
//   FP5 (static half) — no Prometheus scrape-server/exporter dependency
//     and no inbound `/metrics` GET route registered (metrics are
//     push-only via POST /api/v1/edge/metrics).
//   FP4 (static half) — every services/edge-node-go/Makefile cross-compile
//     target builds with CGO_ENABLED=0, so the release binaries
//     (.github/workflows/publish-release.yml uploads them straight to the
//     GitHub Release — no monorepo clone needed to fetch or run one) stay
//     statically linked instead of silently depending on host shared
//     libraries. A dynamically-linked binary would break the "single
//     binary fetchable by URL" claim on a host missing those libs.
//
// FP6, FP7 are NOT covered here — see the BI-4B381171 PR body for what's
// covered elsewhere (FP7 partial, in packages/validators) and what's a
// documented gap (FP6 — no redaction implementation exists yet).
//
//   node scripts/check-edge-node-image-bom.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TS_PACKAGE_JSON = join(REPO_ROOT, "services/edge-node/package.json");
const TS_SRC_DIR = join(REPO_ROOT, "services/edge-node/src");
const GO_MOD = join(REPO_ROOT, "services/edge-node-go/go.mod");
const GO_MAKEFILE = join(REPO_ROOT, "services/edge-node-go/Makefile");
const GO_SRC_DIRS = [
  join(REPO_ROOT, "services/edge-node-go/cmd"),
  join(REPO_ROOT, "services/edge-node-go/internal"),
];

// --- FP2 / FP3 dependency allow-list (deny-list, really) -------------------
// Substring match against the package name (npm) or module path (Go). Keep
// these as recognizable product/library names, not generic words, so the
// gate doesn't false-positive on an unrelated dependency that happens to
// share a token.
const DENY_RELATIONAL_GRAPH_VECTOR = [
  // relational
  "pg",
  "postgres",
  "prisma",
  "mysql",
  "mariadb",
  "sqlite",
  "knex",
  "typeorm",
  "sequelize",
  "drizzle-orm",
  // graph
  "neo4j",
  // vector
  "qdrant",
  "pinecone",
  "weaviate",
  "chromadb",
  // generic cache/kv stores the spec also excludes from the edge (state is
  // one JSON file, not a store)
  "redis",
  "mongodb",
  "mongoose",
];

const DENY_LLM_MODEL_RUNTIME = [
  "openai",
  "anthropic",
  "@anthropic-ai",
  "langchain",
  "llamaindex",
  "ollama",
  "cohere",
  "replicate",
  "huggingface",
  "@huggingface",
  "onnxruntime",
  "@xenova/transformers",
  "node-llama-cpp",
];

const DENY_PROMETHEUS_SERVER = ["prom-client", "prometheus/client_golang", "express-prom-bundle"];

const PROVIDER_KEY_ENV_PATTERNS = [
  /\bOPENAI_API_KEY\b/,
  /\bANTHROPIC_API_KEY\b/,
  /\bAZURE_OPENAI_API_KEY\b/,
  /\bGOOGLE_API_KEY\b/,
  /\bGEMINI_API_KEY\b/,
  /\bCOHERE_API_KEY\b/,
  /\bMISTRAL_API_KEY\b/,
  /\bGROQ_API_KEY\b/,
  /\bTOGETHER_API_KEY\b/,
  /\bREPLICATE_API_TOKEN\b/,
  /\bHUGGINGFACE_API_KEY\b/,
  /\bHF_API_TOKEN\b/,
];

// FP1 static: inbound listener setup. Deliberately coarse (string match, not
// AST) — this is a bill-of-materials sanity gate, not a full static
// analyzer; a hit should prompt a human look, not necessarily block on its
// own merit if it's a false positive (e.g. a doc comment).
const INBOUND_LISTENER_PATTERNS = [
  /\bcreateServer\s*\(/,
  /\.listen\s*\(/,
  /\bListenAndServe\s*\(/,
  /\bListenAndServeTLS\s*\(/,
  /\bnet\.Listen\s*\(/,
  /\bnet\.ListenTCP\s*\(/,
  /\bnet\.ListenUDP\s*\(/,
];

// FP5 static: an inbound scrape-style route registration for /metrics.
const METRICS_ROUTE_PATTERNS = [
  /["'`]\/metrics["'`]/, // route string literal — flagged for manual review, not an automatic fail (see below)
];

const violations = [];
const notes = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "bin") continue;
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// Token-based match, not raw substring: a short denied word like "pg" must
// match a whole `/`, `@`, `-`, `.`-delimited segment of the dependency name
// (e.g. "pg" matches "pg" and "@types/pg", not "pngjs" or an unrelated
// "golang.org/x/tools" module). Longer, unambiguous denied words (e.g.
// "postgres", "prisma") still match as a substring so scoped/suffixed
// variants (e.g. "@prisma/client") are caught too.
function depTokens(name) {
  return name.toLowerCase().split(/[/@\-.]+/).filter(Boolean);
}

function checkDenyList(depNames, denyList, label, source) {
  for (const dep of depNames) {
    const lower = dep.toLowerCase();
    const tokens = depTokens(dep);
    for (const denied of denyList) {
      const matches =
        denied.length <= 3 ? tokens.includes(denied) : lower.includes(denied);
      if (matches) {
        violations.push(
          `${label}: ${source} declares dependency "${dep}" which matches the denied pattern "${denied}".`,
        );
      }
    }
  }
}

// --- TS side (services/edge-node) ------------------------------------------

const tsPkg = readJson(TS_PACKAGE_JSON);
const tsDeps = [
  ...Object.keys(tsPkg.dependencies ?? {}),
  ...Object.keys(tsPkg.devDependencies ?? {}),
];
checkDenyList(tsDeps, DENY_RELATIONAL_GRAPH_VECTOR, "FP2", "services/edge-node/package.json");
checkDenyList(tsDeps, DENY_LLM_MODEL_RUNTIME, "FP3", "services/edge-node/package.json");
checkDenyList(tsDeps, DENY_PROMETHEUS_SERVER, "FP5", "services/edge-node/package.json");

// --- Go side (services/edge-node-go) ----------------------------------------

const goModText = readFileSync(GO_MOD, "utf8");
const goModules = [...goModText.matchAll(/^\s*([a-zA-Z0-9._\-/]+)\s+v[0-9]/gm)].map((m) => m[1]);
checkDenyList(goModules, DENY_RELATIONAL_GRAPH_VECTOR, "FP2", "services/edge-node-go/go.mod");
checkDenyList(goModules, DENY_LLM_MODEL_RUNTIME, "FP3", "services/edge-node-go/go.mod");
checkDenyList(goModules, DENY_PROMETHEUS_SERVER, "FP5", "services/edge-node-go/go.mod");

// --- FP4 static half: every cross-compile target stays statically linked ---

const makefileText = readFileSync(GO_MAKEFILE, "utf8");
const makefileLines = makefileText.split("\n");
let currentTarget = null;
for (const line of makefileLines) {
  const targetMatch = line.match(/^([a-zA-Z0-9_-]+):/);
  if (targetMatch) {
    currentTarget = targetMatch[1];
    continue;
  }
  if (
    currentTarget &&
    currentTarget.startsWith("build-") &&
    /\$\(GO\)\s+build/.test(line) &&
    !/CGO_ENABLED=0/.test(line)
  ) {
    violations.push(
      `FP4: services/edge-node-go/Makefile target "${currentTarget}" builds without CGO_ENABLED=0 — the release binary would silently depend on host shared libraries, breaking the single-binary-fetchable-by-URL claim.`,
    );
  }
}

// --- Source-pattern scans (FP1 inbound listener, FP3 provider keys, FP5 route) --

const tsSourceFiles = walkFiles(TS_SRC_DIR, [".ts"]);
const goSourceFiles = GO_SRC_DIRS.flatMap((d) => walkFiles(d, [".go"]));
const allSourceFiles = [...tsSourceFiles, ...goSourceFiles];

for (const file of allSourceFiles) {
  const rel = relative(REPO_ROOT, file);
  const text = readFileSync(file, "utf8");

  for (const pattern of INBOUND_LISTENER_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(
        `FP1: ${rel} matches inbound-listener pattern ${pattern} — the edge runtime must be outbound-only.`,
      );
    }
  }

  for (const pattern of PROVIDER_KEY_ENV_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(
        `FP3: ${rel} references a model-provider API key env var (${pattern}) — the edge runtime must not require LLM credentials.`,
      );
    }
  }

  for (const pattern of METRICS_ROUTE_PATTERNS) {
    if (pattern.test(text) && !rel.includes(".test.") && !rel.endsWith("_test.go")) {
      // Non-fatal: flagged as a note, not a violation, because
      // api-client.ts legitimately contains the string "/api/v1/edge/metrics"
      // (the outbound POST target) which is a substring match on
      // "/metrics". A human confirms whether this is the outbound POST
      // path (fine) or an inbound scrape GET handler (FP5 violation).
      notes.push(`FP5 (review): ${rel} contains a "/metrics" string literal — confirm this is the outbound POST path, not an inbound scrape route.`);
    }
  }
}

// --- Report ------------------------------------------------------------------

if (notes.length > 0) {
  console.log("Notes (non-fatal, human review):");
  for (const n of notes) console.log(`  - ${n}`);
  console.log("");
}

if (violations.length > 0) {
  console.error(`edge-node image BoM check FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nThe edge node's minimal footprint (FP1-FP5 static halves) is a contract, not a" +
      " convention — see docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md §6." +
      " If this dependency/pattern is genuinely required, update the spec's footprint table" +
      " first, then this script's allow-list, with a tracking BI reference.",
  );
  process.exit(1);
}

console.log(
  `edge-node image BoM check passed: ${tsDeps.length} TS deps, ${goModules.length} Go modules,` +
    ` ${allSourceFiles.length} source files, Makefile cross-compile targets scanned —` +
    ` no FP1/FP2/FP3/FP4(static)/FP5(static) violations.`,
);
