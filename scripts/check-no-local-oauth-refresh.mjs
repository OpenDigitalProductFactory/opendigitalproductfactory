#!/usr/bin/env node
/**
 * BI-ABC88965 (EP-8DC217EB BET-3) — CI ratchet: no NEW hand-rolled OAuth
 * `refresh_token` grant client.
 *
 * The RFC-6749 `refresh_token` exchange over undici `request` was hand-copied
 * into a near-identical ~110-LOC `token-client.ts` per provider (QuickBooks,
 * Google Marketing Intelligence, ...), each re-deriving the same form-encoded
 * `grant_type=refresh_token` POST, the same status ladder, and the same payload
 * mapping. It now has one canonical home:
 *
 *   import { refreshOAuthToken } from "@dpf/integration-shared";
 *
 * This guard freezes the copy count. A file is a violation when it BOTH builds
 * a `grant_type=refresh_token` body AND calls undici `request` — i.e. a raw
 * refresh-token token client — anywhere outside the canonical home. New code
 * must call `refreshOAuthToken` instead of spawning copy N+1.
 *
 * Out of scope by construction: the `client_credentials` grant (Microsoft 365,
 * ADP) is a different flow and is not matched; provider-oauth.ts refreshes over
 * `fetch` (not undici `request`) and is a provider-agnostic DB flow, so it is
 * not matched either.
 *
 * Scope: apps/web/lib, services, packages (source only, tests excluded). The
 * canonical definition in packages/integration-shared/src/oauth-refresh.ts is
 * the single sanctioned home and is skipped by path.
 *
 * Run: node scripts/check-no-local-oauth-refresh.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The one sanctioned home for the refresh_token exchange — never flagged.
export const CANONICAL = "packages/integration-shared/src/oauth-refresh.ts";

// Source roots that may contain provider token clients.
export const SCAN_DIRS = ["apps/web/lib", "services", "packages"];

// Files that STILL hand-roll a refresh_token client at the BI-ABC88965 baseline
// (a migration backlog — delete an entry once the file calls refreshOAuthToken).
// Aim: empty. The migrated QuickBooks/Google wrappers no longer contain the raw
// request, so nothing is allowlisted.
export const ALLOWLIST = new Set([]);

/** A `grant_type=refresh_token` form body — object-literal or `.set(...)` form. */
const REFRESH_GRANT_PATTERNS = [
  /grant_type["']?\s*:\s*["']refresh_token["']/,
  /["']grant_type["']\s*,\s*["']refresh_token["']/,
  /grant_type=refresh_token/,
];

/** Imports `request` from undici AND calls it. */
function usesUndiciRequest(body) {
  const importsRequest = /import\s*\{[^}]*\brequest\b[^}]*\}\s*from\s*["']undici["']/.test(body);
  const callsRequest = /\brequest\s*\(/.test(body);
  return importsRequest && callsRequest;
}

function hasRefreshTokenGrant(body) {
  return REFRESH_GRANT_PATTERNS.some((p) => p.test(body));
}

/** True when `body` is a raw undici refresh_token token client. */
export function isRefreshTokenGrantClient(body) {
  return hasRefreshTokenGrant(body) && usesUndiciRequest(body);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Scan SCAN_DIRS under `root`; return raw refresh-token clients outside the allowlist. */
export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    const scanDir = join(root, dir);
    if (!existsSync(scanDir)) continue;
    for (const file of walk(scanDir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (isRefreshTokenGrantClient(body)) {
        violations.push({ file: rel });
      }
    }
  }
  return violations;
}

/** Allowlisted files that no longer hand-roll a refresh_token client — stale entries. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel); // file gone
      continue;
    }
    if (!isRefreshTokenGrantClient(body)) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-ABC88965 — a NEW hand-rolled OAuth refresh_token client was added.");
    console.error("");
    console.error("There is one canonical refresh_token exchange. Call it instead of copying:");
    console.error('  import { refreshOAuthToken } from "@dpf/integration-shared";');
    console.error("");
    console.error("Offending files (build a grant_type=refresh_token body + call undici request):");
    for (const v of violations) console.error(`  ${v.file}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-ABC88965 — the oauth-refresh allowlist is stale.");
    console.error("These files no longer hand-roll a refresh_token client (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-oauth-refresh.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new hand-rolled OAuth refresh_token clients (${ALLOWLIST.size} pending migration to @dpf/integration-shared).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
