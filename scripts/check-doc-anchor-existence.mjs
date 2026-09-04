#!/usr/bin/env node
// scripts/check-doc-anchor-existence.mjs
//
// BI-3F17B16B (Simplify & Strengthen W1, pass §2 / Tier-0 #1) — doc anchor
// existence: an EP-/BI-/DI-/WC- id cited in a changed doc must exist in the
// live backlog.
//
// THE PROBLEM IT FIXES: the 2026-08-01 hardening plan — the platform's
// flagship architecture program — cited EP-413F2602, BI-C04CAD7F and
// BI-2E9F6D37 as its coordination anchors, and none existed in the live
// backlog ("unbacked doc anchors", pass §2 / §3.5). Docs governed the work;
// the coordination plane never saw it. "MCP is the coordination plane"
// (AGENTS.md §12) is violated silently every time this happens.
//
// THE CONTRACT (diff-scoped, like check-docs-impact):
//   - Only CHANGED docs (vs BASE_SHA, default origin/main) are checked — the
//     ~654-spec corpus is not retro-checked.
//   - Existing (doc, id) pairs are grandfathered in
//     scripts/doc-anchor-baseline.txt (owned expiring budget; --update
//     regenerates it from a full offline scan, no verification).
//   - A NEW pair in a changed doc is verified against the live install over
//     the MCP HTTP endpoint (get_backlog_item for BI-*, list_epics for EP-*).
//     WC-*/DI-* ids have no governed lookup tool yet — they are recorded and
//     reported, not enforced.
//   - DEGRADES GRACEFULLY: no bearer token, unreachable endpoint, or an
//     ambiguous response ⇒ WARN and pass, printing exactly what was skipped.
//     CI without a live install must never hard-fail here; the gate bites on
//     contributor machines and installs where the portal is up.
//   - DOES NOT degrade on an unresolvable BASE_SHA (BI-B6433DC6). "I could not
//     compute the diff" is not "the diff was empty". That case exits non-zero
//     and must never print OK.
//
//   node scripts/check-doc-anchor-existence.mjs            # check (CI)
//   node scripts/check-doc-anchor-existence.mjs --update   # regenerate the grandfather baseline
//
// Endpoint: $DPF_MCP_ENDPOINT (default http://127.0.0.1:3000/api/mcp/v1),
// bearer $DPF_MCP_BEARER_TOKEN.

import fs from "node:fs";
import path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";
import { listChangedFiles, runGit } from "./lib/git-changed-files.mjs";

export { listChangedFiles, runGit };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "doc-anchor-baseline.txt");
export const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/mcp/v1";
const FETCH_TIMEOUT_MS = 5000;

const DEFAULT_BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const BUDGET_NOTE_LINES = Object.freeze([
  "Grandfathered doc->anchor citations (BI-3F17B16B). One <doc-path>\\t<id> pair",
  "per line. Pairs here are NOT retro-verified; a NEW pair in a changed doc is",
  "verified against the live backlog over MCP. Shrink-only — never park a new",
  "citation here. Regenerate with: node scripts/check-doc-anchor-existence.mjs --update",
]);

// Hex-shaped platform ids only. Named-slug epics (EP-WORK-CONVERGENCE) are
// deliberately out of scope — they are indistinguishable from prose acronyms
// without a live lookup, and the unbacked-anchor incidents were hex-shaped.
const ID_RE = /\b(?:EP|BI|WC)-[0-9A-F]{8}\b|\bDI-[0-9A-F]{12}\b/g;

/** Extract the sorted unique anchor ids cited in a markdown body. */
export function extractAnchorIds(markdown) {
  return [...new Set(String(markdown).match(ID_RE) ?? [])].sort();
}

/** Which verification lane an id takes. */
export function classifyId(id) {
  if (id.startsWith("BI-")) return "backlog-item";
  if (id.startsWith("EP-")) return "epic";
  return "unverifiable"; // WC-* (workroom) / DI-* (decision) — no governed lookup tool named yet
}

/** Parse baseline text into a Set of "doc\tid" keys (comment lines skipped). */
export function parseAnchorBaseline(text) {
  const keys = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    keys.add(line.split(/\s+/).slice(0, 2).join("\t"));
  }
  return keys;
}

export function serializeAnchorBaseline(pairs, budget = DEFAULT_BUDGET) {
  const header = formatTxtBudgetHeader({ ...budget, noteLines: BUDGET_NOTE_LINES });
  const lines = [...new Set(pairs.map(({ doc, id }) => `${doc}\t${id}`))].sort();
  return `${header}${lines.join("\n")}\n`;
}

/**
 * Decide the verdict for one id from a raw MCP tools/call response.
 * Returns "exists" | "missing" | "unknown" (unknown ⇒ warn-skip, never fail —
 * an auth error or a malformed body must not fabricate a missing anchor).
 */
export function interpretToolResponse(kind, id, body) {
  let parsed;
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return "unknown";
  }
  if (!parsed || typeof parsed !== "object") return "unknown";
  if (parsed.error) return "unknown"; // JSON-RPC error (auth/scope/transport) — not evidence of absence
  const result = parsed.result ?? parsed;
  const text = JSON.stringify(result);
  if (kind === "epic") {
    return text.includes(id) ? "exists" : "missing";
  }
  // BI-34C7A7F8: a genuine miss is an ERROR RESULT carrying not_found — NOT the
  // phrase "not found" appearing anywhere in the payload. The payload includes
  // the item's own body and evidence records, and bug reports quote that phrase
  // constantly ("Directory not found", "Build not found"), so a content match
  // declared real items missing and blocked commits that cited them correctly.
  // Reordering alone would not do: a real miss ALSO echoes the requested id.
  const isErrorResult =
    result && typeof result === "object" && result.isError === true;
  if (isErrorResult) {
    return /not_found/i.test(text) ? "missing" : "unknown";
  }
  if (text.includes(id)) return "exists";
  return "unknown";
}

/** POST one MCP tools/call. Returns the raw response text, or null on failure. */
/**
 * True when a catalog response admits it did not return everything. The tool
 * reports `total`/`fetched`/`truncated`; any of those signalling a short read
 * means an id absent from the page is not evidence the id does not exist.
 */
export function isTruncatedListing(body) {
  let parsed;
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return true; // unparseable is not proof of completeness
  }
  const text = JSON.stringify(parsed?.result ?? parsed ?? null);
  if (/"truncated"\s*:\s*true/.test(text)) return true;
  const total = text.match(/"total"\s*:\s*(\d+)/);
  const fetched = text.match(/"fetched"\s*:\s*(\d+)/);
  if (total && fetched && Number(fetched[1]) < Number(total[1])) return true;
  return false;
}

export async function callTool(endpoint, token, name, args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify new pairs. `lookup(kind, id)` resolves to "exists"|"missing"|"unknown".
 * Returns { missing, skipped, unverifiable, verified } lists of pairs.
 */
export async function verifyAnchors(pairs, lookup) {
  const missing = [];
  const skipped = [];
  const unverifiable = [];
  const verified = [];
  for (const pair of pairs) {
    const kind = classifyId(pair.id);
    if (kind === "unverifiable") {
      unverifiable.push(pair);
      continue;
    }
    const verdict = await lookup(kind, pair.id);
    if (verdict === "missing") missing.push(pair);
    else if (verdict === "exists") verified.push(pair);
    else skipped.push(pair);
  }
  return { missing, skipped, unverifiable, verified };
}

const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;

function scanAllDocs() {
  const pairs = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = path.relative(REPO_ROOT, full).replaceAll("\\", "/");
        for (const id of extractAnchorIds(fs.readFileSync(full, "utf8"))) pairs.push({ doc: rel, id });
      }
    }
  };
  walk(path.join(REPO_ROOT, "docs"));
  return pairs;
}

async function main() {
  if (process.argv.includes("--update")) {
    let budget = DEFAULT_BUDGET;
    try {
      const existing = parseTxtBudgetHeader(fs.readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch { /* first run — defaults */ }
    const pairs = scanAllDocs();
    fs.writeFileSync(BASELINE_PATH, serializeAnchorBaseline(pairs, budget));
    console.log(`Wrote doc-anchor baseline: ${new Set(pairs.map((p) => `${p.doc}\t${p.id}`)).size} grandfathered pairs.`);
    return;
  }

  let baseline;
  try {
    baseline = parseAnchorBaseline(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`[doc-anchor] Missing ${path.relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-doc-anchor-existence.mjs --update`);
    process.exit(1);
  }

  const base = process.env.BASE_SHA || "origin/main";
  if (!REF_RE.test(base) || base.startsWith("-")) {
    console.error(`[doc-anchor] refusing unsafe BASE_SHA: ${JSON.stringify(base)}`);
    process.exit(1);
  }
  const changed = listChangedFiles(base);
  if (changed.status === "unresolvable") {
    console.error(`[doc-anchor] cannot resolve ${base} — the guard did not run. This is not a pass.`);
    console.error("[doc-anchor] Remedy: git fetch --deepen 50 origin  (or git fetch origin main) and re-run.");
    if (changed.detail) console.error(`[doc-anchor] git: ${changed.detail}`);
    process.exit(1);
  }
  if (changed.files.length === 0) {
    console.log(`[doc-anchor] No diff against ${base} — nothing to check. OK.`);
    return;
  }
  const changedDocs = changed.files.filter((f) => f.startsWith("docs/") && f.endsWith(".md"));

  const newPairs = [];
  for (const doc of changedDocs) {
    const abs = path.join(REPO_ROOT, doc);
    if (!fs.existsSync(abs)) continue; // deleted doc
    for (const id of extractAnchorIds(fs.readFileSync(abs, "utf8"))) {
      if (!baseline.has(`${doc}\t${id}`)) newPairs.push({ doc, id });
    }
  }

  if (newPairs.length === 0) {
    console.log(`[doc-anchor] ${changedDocs.length} changed doc(s), no new EP-/BI-/DI-/WC- citations beyond the baseline. OK.`);
    return;
  }

  const token = process.env.DPF_MCP_BEARER_TOKEN;
  const endpoint = process.env.DPF_MCP_ENDPOINT || DEFAULT_ENDPOINT;
  if (!token) {
    console.warn(`[doc-anchor] WARN: ${newPairs.length} new citation(s) NOT verified — DPF_MCP_BEARER_TOKEN unset (no live install on this runner). Skipped:`);
    for (const p of newPairs) console.warn(`  ~ ${p.doc}: ${p.id}`);
    console.warn("[doc-anchor] Passing (degraded). Verify on an install with the portal up before merge.");
    return;
  }

  let epicListing = null; // one list_epics call serves every EP-* id
  const lookup = async (kind, id) => {
    if (kind === "epic") {
      if (epicListing === null) {
        // list_epics defaults to 100 rows. An install with more epics than that
        // returned a TRUNCATED catalog, and every id past the cut read as
        // "missing" — a correctly cited, freshly filed epic failed the guard.
        // Ask for the documented maximum, and if the catalog is STILL truncated
        // treat epic lookups as unverifiable rather than absent: everywhere else
        // this guard fails open on uncertainty, and a partial listing is exactly
        // that. Absence must be proven, never inferred from a short page.
        const listing = await callTool(endpoint, token, "list_epics", { limit: 1000 });
        epicListing = listing == null || isTruncatedListing(listing)
          ? "unreachable"
          : listing;
      }
      if (epicListing === "unreachable") return "unknown";
      return interpretToolResponse("epic", id, epicListing);
    }
    const body = await callTool(endpoint, token, "get_backlog_item", { itemId: id });
    if (body === null) return "unknown";
    return interpretToolResponse("backlog-item", id, body);
  };

  const { missing, skipped, unverifiable, verified } = await verifyAnchors(newPairs, lookup);

  if (unverifiable.length > 0) {
    console.log(`[doc-anchor] ${unverifiable.length} WC-/DI- citation(s) recorded but not verified (no governed lookup tool):`);
    for (const p of unverifiable) console.log(`  ~ ${p.doc}: ${p.id}`);
  }
  if (skipped.length > 0) {
    console.warn(`[doc-anchor] WARN: ${skipped.length} citation(s) skipped — endpoint unreachable or response ambiguous (never treated as missing):`);
    for (const p of skipped) console.warn(`  ~ ${p.doc}: ${p.id}`);
  }
  if (verified.length > 0) {
    console.log(`[doc-anchor] ${verified.length} citation(s) verified live.`);
  }

  if (missing.length > 0) {
    console.error("");
    console.error("[doc-anchor] FAILED — changed doc(s) cite backlog anchors that do NOT exist in the live backlog:");
    for (const p of missing) console.error(`  ✗ ${p.doc}: ${p.id}`);
    console.error("");
    console.error("File the epic/BI first (dpf-file-backlog-item), or correct the id. Docs must not govern work");
    console.error("the coordination plane cannot see (AGENTS.md §12; pass §2 'unbacked doc anchors').");
    process.exit(1);
  }
  console.log("[doc-anchor] OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
