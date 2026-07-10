#!/usr/bin/env node
/**
 * BI-ABC88965 (EP-8DC217EB BET-3 increment 2) — CI ratchet: no NEW hand-rolled
 * OAuth `client_credentials` grant client.
 *
 * The RFC-6749 `client_credentials` exchange over undici `request` was hand-
 * copied into a near-identical `token-client.ts` per provider (Microsoft 365
 * Communications, ADP), each re-deriving the same form-encoded
 * `grant_type=client_credentials` POST, the same status ladder, and the same
 * payload mapping. It now has one canonical home:
 *
 *   import { exchangeClientCredentials } from "@dpf/integration-shared";
 *
 * This guard freezes the copy count — the sibling of
 * check-no-local-oauth-refresh.mjs (which freezes the `refresh_token` grant). A
 * file is a violation when it BOTH builds a `grant_type=client_credentials` body
 * AND calls undici `request` — i.e. a raw client-credentials token client —
 * anywhere outside the canonical home. New code must call
 * `exchangeClientCredentials` instead of spawning copy N+1.
 *
 * Out of scope by construction: the `refresh_token` grant is matched by the
 * sibling guard, not this one; fetch-based flows (no undici `request`) are not
 * matched.
 *
 * Scope: apps/web/lib, services, packages (source only, tests excluded). The
 * canonical definition in packages/integration-shared/src/client-credentials.ts
 * is the single sanctioned home and is skipped by path.
 *
 * Run: node scripts/check-no-local-client-credentials.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The one sanctioned home for the client_credentials exchange — never flagged.
export const CANONICAL = "packages/integration-shared/src/client-credentials.ts";

// Source roots that may contain provider token clients.
export const SCAN_DIRS = ["apps/web/lib", "services", "packages"];

// Files that STILL hand-roll a client_credentials client at the BI-ABC88965
// increment-2 baseline (a migration backlog — delete an entry once the file
// calls exchangeClientCredentials). The two apps/web wrappers (Microsoft 365 +
// ADP) are migrated and hold no raw request, so they are NOT here.
//
// The ONE allowlisted entry is a deliberate, documented follow-on:
// services/adp/src/lib/token-client.ts (a standalone service, reached via the
// services/ scan root) injects a harness-transport header
// (`X-DPF-Harness-Session` via getHarnessRequestHeaders) and selects its
// dispatcher through isHarnessTransport(url). The harness HEADER has no
// representation in ClientCredentialsConfig (which only exposes extra BODY
// params), so migrating it would require expanding the increment-2 contract or
// silently dropping the harness header — a behavior change to the integration
// harness. It is kept green here with this rationale, to be migrated when the
// shared helper grows an extra-headers axis.
export const ALLOWLIST = new Set(["services/adp/src/lib/token-client.ts"]);

/** A `grant_type=client_credentials` form body — object-literal or `.set(...)` form. */
const CLIENT_CREDENTIALS_GRANT_PATTERNS = [
  /grant_type["']?\s*:\s*["']client_credentials["']/,
  /["']grant_type["']\s*,\s*["']client_credentials["']/,
  /grant_type=client_credentials/,
];

/** Imports `request` from undici AND calls it. */
function usesUndiciRequest(body) {
  const importsRequest = /import\s*\{[^}]*\brequest\b[^}]*\}\s*from\s*["']undici["']/.test(body);
  const callsRequest = /\brequest\s*\(/.test(body);
  return importsRequest && callsRequest;
}

function hasClientCredentialsGrant(body) {
  return CLIENT_CREDENTIALS_GRANT_PATTERNS.some((p) => p.test(body));
}

/** True when `body` is a raw undici client_credentials token client. */
export function isClientCredentialsGrantClient(body) {
  return hasClientCredentialsGrant(body) && usesUndiciRequest(body);
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

/** Scan SCAN_DIRS under `root`; return raw client-credentials clients outside the allowlist. */
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
      if (isClientCredentialsGrantClient(body)) {
        violations.push({ file: rel });
      }
    }
  }
  return violations;
}

/** Allowlisted files that no longer hand-roll a client-credentials client — stale entries. */
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
    if (!isClientCredentialsGrantClient(body)) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-ABC88965 — a NEW hand-rolled OAuth client_credentials client was added.");
    console.error("");
    console.error("There is one canonical client_credentials exchange. Call it instead of copying:");
    console.error('  import { exchangeClientCredentials } from "@dpf/integration-shared";');
    console.error("");
    console.error("Offending files (build a grant_type=client_credentials body + call undici request):");
    for (const v of violations) console.error(`  ${v.file}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-ABC88965 — the client-credentials allowlist is stale.");
    console.error("These files no longer hand-roll a client_credentials client (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-client-credentials.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new hand-rolled OAuth client_credentials clients (${ALLOWLIST.size} pending migration to @dpf/integration-shared).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
