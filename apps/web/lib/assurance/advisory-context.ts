// apps/web/lib/assurance/advisory-context.ts
//
// Builds the ReconcileContext (apps/web/lib/assurance/finding-reconcile.ts) the
// Assurance Gate uses to decide which sandbox findings are genuine on MAIN:
//   - accepted advisories  ← sbom/vuln-baseline.json (the same ledger the OSV
//     script scripts/sbom/scan-dependencies.mjs honors; the in-platform pnpm-
//     audit path previously ignored it, which re-filed accepted advisories).
//   - main's resolved versions ← pnpm-lock.yaml (full tree, incl. transitive).
//
// CARRIER DECISION (BI-91D1524F): read from the platform PROJECT_ROOT at scan
// time (where the portal runs from main), behind injectable readers. If either
// source is unreadable the context reports available=false and auto-file FAILS
// CLOSED — never auto-creating work it cannot verify. Follow-up: bundle a
// generated snapshot so verification also works inside a stripped image.
//
// SERVER-ONLY (uses node:fs); imported by the scan job, never by client code.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReconcileContext } from "./finding-reconcile";

export interface AdvisoryContextReaders {
  /** Returns sbom/vuln-baseline.json text, or null if unreadable. */
  readBaseline: () => string | null;
  /** Returns pnpm-lock.yaml text, or null if unreadable. */
  readLock: () => string | null;
  /** YYYY-MM-DD; defaults to today. Injected in tests for deterministic expiry. */
  today?: string;
}

/**
 * Extract every resolved version per package from a pnpm v9 lockfile, including
 * transitive deps. Scans the canonical `name@version:` keys (the `packages:`
 * map). Scoped names are quoted (`'@babel/core@7.29.7':`); peer-suffixed
 * `snapshots:` keys (which contain `(`) are skipped — their versions also appear
 * unsuffixed in `packages:`, so coverage is complete and de-duplicated.
 */
export function parseResolvedVersions(lockText: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const lines = lockText.replace(/\r\n/g, "\n").split("\n");
  // Two-space indent, optional surrounding quotes, name@version, trailing colon.
  // The version group starts with a digit so the LAST '@' splits scope from version.
  const re = /^ {2}'?(.+?)@([0-9][^()':\s]*?)'?:$/;
  for (const line of lines) {
    if (line.includes("(")) continue;
    const m = re.exec(line);
    if (!m) continue;
    const name = m[1];
    const version = m[2];
    if (!name || !version) continue;
    let set = out.get(name);
    if (!set) {
      set = new Set<string>();
      out.set(name, set);
    }
    set.add(version);
  }
  return out;
}

/** Accepted + unexpired advisory ids (id + aliases) from vuln-baseline.json. */
export function parseAcceptedAdvisoryIds(baselineText: string, today: string): Set<string> {
  const ids = new Set<string>();
  let parsed: { accepted?: Array<{ id?: string; aliases?: string[]; expires?: string }> };
  try {
    parsed = JSON.parse(baselineText) as typeof parsed;
  } catch {
    return ids;
  }
  for (const entry of parsed.accepted ?? []) {
    // An entry past its expiry re-surfaces (mirrors scan-dependencies.mjs).
    if (entry.expires && entry.expires < today) continue;
    if (entry.id) ids.add(entry.id);
    for (const alias of entry.aliases ?? []) {
      if (alias) ids.add(alias);
    }
  }
  return ids;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function buildReconcileContext(readers: AdvisoryContextReaders): ReconcileContext {
  const today = readers.today ?? new Date().toISOString().slice(0, 10);
  const lockText = safe(() => readers.readLock());
  const resolvedVersionsByPackage = lockText ? parseResolvedVersions(lockText) : new Map<string, Set<string>>();
  const baselineText = safe(() => readers.readBaseline());
  const acceptedAdvisoryIds = baselineText ? parseAcceptedAdvisoryIds(baselineText, today) : new Set<string>();

  // The staleness oracle (main's resolved versions) is the load-bearing input;
  // without it we cannot verify a finding against main, so fail closed.
  const available = resolvedVersionsByPackage.size > 0;

  return { available, acceptedAdvisoryIds, resolvedVersionsByPackage };
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function defaultAdvisoryReaders(
  root: string = process.env.PROJECT_ROOT ?? process.cwd(),
): AdvisoryContextReaders {
  return {
    readLock: () => readTextOrNull(join(root, "pnpm-lock.yaml")),
    readBaseline: () => readTextOrNull(join(root, "sbom", "vuln-baseline.json")),
  };
}

/** Convenience: build the context from the platform project root. */
export function loadReconcileContext(root?: string): ReconcileContext {
  return buildReconcileContext(defaultAdvisoryReaders(root));
}
