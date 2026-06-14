// apps/web/lib/ea/architecture-parity.ts
//
// Pure core of the Architecture Parity audit (design↔implementation drift gate).
//
// SysML/EA current-state elements that are tagged provenance:"deterministic" carry
// a `sourceKey` pointing at the real code/schema they model (e.g.
// `apps/web/lib/mcp-governed-execute.ts` or `packages/db/prisma/schema.prisma#Agent`).
// Those claims silently rot when code moves/renames/deletes — the model says one
// thing, the implementation says another. This module turns that silent drift into a
// checkable invariant: every deterministic sourceKey MUST still resolve to a real
// file (and, when it names a clean symbol, that symbol must still appear there).
//
// Pure + dependency-free so it is unit-testable with an injected resolver; the IO
// shell (scripts/audit-architecture-parity.ts) supplies a real filesystem resolver
// and the baseline-diff / CI wiring. Mirrors the pure/IO split of data-model-mirror.
//
// Design: docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md
// WWMD anchor: remove-avoidable-failure-opportunities (automation over vigilance).

export type ParitySeverity = "error" | "warn";

export interface ParityFinding {
  /** PARITY-001 = modeled path missing; PARITY-002 = modeled symbol not found. */
  invariantId: "PARITY-001" | "PARITY-002";
  severity: ParitySeverity;
  /** The full deterministic sourceKey the element claimed. */
  sourceKey: string;
  /** The path segment under scrutiny. */
  file: string | null;
  summary: string;
  detail: string;
}

/**
 * Extract the first string argument of every `det("...")` call in a seed source
 * file. `det(sourceKey, extra?)` is the helper that tags an EA element
 * provenance:"deterministic" — so its first arg is a load-bearing claim that the
 * referenced code exists now. `arch(...)` (architect-judgment, may be planned) is
 * intentionally NOT matched: aspirational/unbuilt references are exempt from parity.
 */
export function extractDeterministicSourceKeys(src: string): string[] {
  const keys: string[] = [];
  const re = /\bdet\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) keys.push(m[1]);
  return keys;
}

export interface SourceRef {
  path: string;
  symbol: string | null;
  raw: string;
}

/**
 * Split a sourceKey into path[#symbol] references. A single key may name several
 * paths separated by `;` (e.g. "a.ts; b.ts#Foo"). Segments with no path-shaped
 * token (purely descriptive prose) are skipped — they are not parity claims.
 */
export function parseSourceKey(key: string): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const seg of key.split(";")) {
    const s = seg.trim();
    if (!s) continue;
    // Leading path token: dotted file path ending in an extension, optional #suffix.
    const m = s.match(/^([\w./-]+\.[A-Za-z0-9]+)(?:#(.+))?$/);
    if (!m) continue;
    refs.push({ path: m[1], symbol: m[2] ?? null, raw: s });
  }
  return refs;
}

/** Resolver: repo-relative path → file text, or null when the path does not exist. */
export type FileResolver = (path: string) => string | null;

/**
 * A clean code identifier (model/function/const name) worth a presence check.
 * Line references (`L210`, `L23-37`) are NOT symbols — they are path-only anchors.
 */
function isCleanSymbol(symbol: string): boolean {
  if (/^L\d+(-\d+)?$/.test(symbol)) return false; // line reference, not a code symbol
  return /^[A-Za-z_]\w*$/.test(symbol);
}

/**
 * Audit a set of deterministic sourceKeys against the implementation via `resolve`.
 * - PARITY-001 (error): the claimed file path does not exist (hard drift).
 * - PARITY-002 (warn): the claimed clean symbol is absent from the file (heuristic;
 *   line-range suffixes like `#L12-20` are path-only and skip the symbol check).
 */
export function auditSourceKeys(keys: string[], resolve: FileResolver): ParityFinding[] {
  const findings: ParityFinding[] = [];
  for (const key of keys) {
    for (const ref of parseSourceKey(key)) {
      const text = resolve(ref.path);
      if (text === null) {
        findings.push({
          invariantId: "PARITY-001",
          severity: "error",
          sourceKey: key,
          file: ref.path,
          summary: `Modeled source path does not exist: ${ref.path}`,
          detail:
            `A deterministic EA/SysML element claims source '${ref.path}', which no longer resolves. ` +
            `Design↔implementation drift: update the element's sourceKey (or restore/rename the code). ` +
            `If the reference is aspirational, re-tag the element provenance:"architect" so it is exempt.`,
        });
        continue;
      }
      if (ref.symbol && isCleanSymbol(ref.symbol)) {
        const present = new RegExp(`\\b${ref.symbol}\\b`).test(text);
        if (!present) {
          findings.push({
            invariantId: "PARITY-002",
            severity: "warn",
            sourceKey: key,
            file: ref.path,
            summary: `Modeled symbol '${ref.symbol}' not found in ${ref.path}`,
            detail:
              `A deterministic EA/SysML element claims symbol '${ref.symbol}' in '${ref.path}', ` +
              `but a heuristic word-boundary search did not find it. It may have been renamed or removed; reconcile the model.`,
          });
        }
      }
    }
  }
  return findings;
}
