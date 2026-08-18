#!/usr/bin/env node
/**
 * W12 (BI-EE64547B, §3.4-mcp move #6a) — CI ratchet: no ad-hoc MCP protocol
 * revisions on the server transport.
 *
 * The `/api/mcp/v1` transport's advertised protocol revisions are governed by
 * ONE constant module: apps/web/lib/mcp/protocol-versions.ts, which declares
 * the N/N-1 VERSION WINDOW (current + one previous) plus the explicitly-listed
 * GRANDFATHERED set (retirement-flagged revisions kept alive pending operator
 * ratification — see docs/superpowers/specs/
 * 2026-08-16-mcp-version-window-contract-brief.md). This guard makes that
 * governance mechanical:
 *
 *   1. the window is exactly two revisions, valid dates, newest first;
 *   2. the grandfathered set may only SHRINK from the frozen list below —
 *      retiring a revision (operator-ratified) is an edit here AND there;
 *      adding one is never allowed;
 *   3. the fallback revision is a member of the advertised union;
 *   4. the transport route declares no protocol-revision literal of its own —
 *      every revision it speaks arrives via the governed import.
 *
 * Scope: the SERVER transport only. Outbound MCP client probes to third-party
 * servers (lib/tak/mcp-server-health.ts) pin their own wire version and are
 * deliberately out of scope.
 *
 *   node scripts/check-no-adhoc-mcp-protocol-versions.mjs   # check (CI)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSIONS_MODULE = join(
  REPO_ROOT, "apps", "web", "lib", "mcp", "protocol-versions.ts",
);
const TRANSPORT_ROUTE = join(
  REPO_ROOT, "apps", "web", "app", "api", "mcp", "v1", "route.ts",
);

/**
 * Retiring a grandfathered revision is operator-ratified: the ratification
 * shrinks BOTH this frozen list and the module constant in the same change.
 * Growing either is what this guard exists to refuse.
 */
export const FROZEN_GRANDFATHERED_SET = Object.freeze(["2025-03-26", "2024-11-05"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Extract the quoted entries of a `const NAME = [ ... ]` block. */
export function extractVersionArray(source, constName) {
  const re = new RegExp(`${constName}\\s*=\\s*(?:Object\\.freeze\\()?\\[([^\\]]*)\\]`);
  const m = re.exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Strip line + block comments so literals in prose don't count. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Date-shaped string literals remaining in code (not comments). */
export function findProtocolLiterals(source) {
  return [...stripComments(source).matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
}

/** Pure evaluation over the two sources; returns a list of errors. */
export function evaluateProtocolGovernance({ versionsSource, routeSource }) {
  const errors = [];

  const window = extractVersionArray(versionsSource, "MCP_VERSION_WINDOW");
  const grandfathered = extractVersionArray(
    versionsSource, "MCP_GRANDFATHERED_PROTOCOL_VERSIONS",
  );
  const fallback = /FALLBACK_PROTOCOL_VERSION\s*=\s*"([^"]+)"/.exec(versionsSource)?.[1] ?? null;

  if (!window) {
    errors.push("MCP_VERSION_WINDOW not found in protocol-versions.ts");
  } else {
    if (window.length !== 2) {
      errors.push(
        `MCP_VERSION_WINDOW must hold exactly current + one previous (2 entries); found ${window.length}: [${window.join(", ")}]`,
      );
    }
    for (const v of window) {
      if (!DATE_RE.test(v)) errors.push(`MCP_VERSION_WINDOW entry is not a revision date: ${v}`);
    }
    if (window.length >= 2 && !(window[0] > window[1])) {
      errors.push(`MCP_VERSION_WINDOW must be newest-first; found [${window.join(", ")}]`);
    }
  }

  if (!grandfathered) {
    errors.push("MCP_GRANDFATHERED_PROTOCOL_VERSIONS not found in protocol-versions.ts");
  } else {
    // Shrink-only against the frozen list: every live entry must be in the
    // frozen set AND keep its relative order; new entries are refused.
    const frozen = FROZEN_GRANDFATHERED_SET;
    let cursor = 0;
    for (const v of grandfathered) {
      const at = frozen.indexOf(v, cursor);
      if (at === -1) {
        errors.push(
          `grandfathered revision "${v}" is not in the frozen retirement-flagged set [${frozen.join(", ")}] — the grandfathered set may only shrink (operator-ratified retirement), never grow`,
        );
      } else {
        cursor = at + 1;
      }
    }
  }

  if (window && grandfathered) {
    const advertised = new Set([...window, ...grandfathered]);
    if (!fallback) {
      errors.push("FALLBACK_PROTOCOL_VERSION not found in protocol-versions.ts");
    } else if (!advertised.has(fallback)) {
      errors.push(
        `FALLBACK_PROTOCOL_VERSION "${fallback}" is not an advertised revision — clients negotiated down would land on a version the transport refuses`,
      );
    }
  }

  const strays = findProtocolLiterals(routeSource);
  if (strays.length > 0) {
    errors.push(
      `app/api/mcp/v1/route.ts declares protocol-revision literal(s) of its own: ${[...new Set(strays)].join(", ")} — revisions must come only from @/lib/mcp/protocol-versions`,
    );
  }
  if (!/from "@\/lib\/mcp\/protocol-versions"/.test(routeSource)) {
    errors.push(
      "app/api/mcp/v1/route.ts no longer imports @/lib/mcp/protocol-versions — negotiation must consume the governed constant",
    );
  }

  return errors;
}

function main() {
  const versionsSource = readFileSync(VERSIONS_MODULE, "utf8");
  const routeSource = readFileSync(TRANSPORT_ROUTE, "utf8");
  const errors = evaluateProtocolGovernance({ versionsSource, routeSource });
  if (errors.length > 0) {
    console.error("MCP protocol-version governance failed (W12, BI-EE64547B):\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      "\nThe advertised revision set is VERSION_WINDOW (N/N-1) + the explicitly-listed",
    );
    console.error(
      "grandfathered set in apps/web/lib/mcp/protocol-versions.ts. Adding or retiring a",
    );
    console.error(
      "revision is an edit to that governed constant (retirement is operator-ratified —",
    );
    console.error(
      "see docs/superpowers/specs/2026-08-16-mcp-version-window-contract-brief.md).",
    );
    process.exit(1);
  }
  console.log(
    "MCP protocol-version governance OK — advertised set = governed N/N-1 window + explicitly-listed grandfathered revisions; no ad-hoc literals on the transport.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
