// scripts/lib/pnpm-lock.mjs
//
// The one reader for pnpm v9 lockfiles (pnpm-lock.yaml and the installed
// node_modules/.pnpm/lock.yaml, which share the shape). Scripts used to carry
// five hand-written line parsers for the same file; they now compose these
// functions (plan 2026-09-08 §10.5 S3). Pure text parsing on purpose: no YAML
// dependency, deterministic, and fast enough for CI gates.
//
// Shape relied on (pnpm lockfileVersion 9):
//   importers:            <- 0 indent
//     <importer>:         <- 2
//       dependencies:     <- 4 (also devDependencies, optionalDependencies)
//         <name>:         <- 6
//           specifier: …  <- 8
//           version: …    <- 8
//   packages:             <- 2-space keys are clean name@version
//   snapshots:            <- 2-space keys carry peer suffixes; 6-space deps
//
// The web app's in-portal SBOM parser (apps/web/lib/assurance/pnpm-lock-parser.ts)
// runs in a different runtime and is not covered here.

export const DEPENDENCY_KINDS = Object.freeze(["dependencies", "devDependencies", "optionalDependencies"]);

/** Lockfile text as lines, CRLF-normalised. */
export function lockLines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

/** Strip one pair of surrounding quotes. */
export function unquote(s) {
  return s.replace(/^['"]|['"]$/g, "");
}

/** Strip a peer-dependency suffix: "16.2.9(@babel/core@7.29.7)" -> "16.2.9". */
export function baseVersion(lockVersion) {
  if (typeof lockVersion !== "string") return "";
  const paren = lockVersion.indexOf("(");
  return (paren >= 0 ? lockVersion.slice(0, paren) : lockVersion).trim();
}

/** Lines of a top-level (column-0) section, excluding its header. */
export function topLevelSection(lines, header) {
  const start = lines.indexOf(header);
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

/**
 * Split a registry key `@scope/name@1.2.3` (peer suffix tolerated) into
 * { name, version }. Null for non-registry specs (file:, link:, git, URLs),
 * which have no registry release.
 */
export function splitNameVersion(key) {
  const base = key.split("(")[0];
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;
  const name = base.slice(0, at);
  const version = base.slice(at + 1);
  if (!name || !version) return null;
  if (version.includes(":") || version.includes("/")) return null;
  return { name, version };
}

/** Keys of the top-level `packages:` map, unquoted, in file order. */
export function parsePackageKeys(text) {
  const keys = [];
  for (const line of topLevelSection(lockLines(text), "packages:")) {
    const m = line.match(/^ {2}(\S.*?):\s*$/);
    if (m) keys.push(unquote(m[1]));
  }
  return keys;
}

/**
 * Direct declarations per importer:
 *   { [importer]: { dependencies: [{ name, specifier, version }], devDependencies: [...], optionalDependencies: [...] } }
 * `version` is the raw resolved value, unquoted (peer suffix and link:/workspace: kept).
 */
export function parseImporters(text) {
  const importers = {};
  let cur = null;
  let kind = null;
  let name = null;
  let spec = null;
  for (const line of topLevelSection(lockLines(text), "importers:")) {
    const imp = line.match(/^ {2}(\S.*):$/);
    if (imp) {
      cur = unquote(imp[1]);
      importers[cur] = { dependencies: [], devDependencies: [], optionalDependencies: [] };
      kind = null;
      name = null;
      spec = null;
      continue;
    }
    const k = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies):$/);
    if (k) {
      kind = k[1];
      name = null;
      spec = null;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      // Another importer-level key (e.g. dependenciesMeta, publishDirectory).
      kind = null;
      name = null;
      continue;
    }
    const nm = line.match(/^ {6}(\S.*):$/);
    if (nm && kind) {
      name = unquote(nm[1]);
      spec = null;
      continue;
    }
    const sp = line.match(/^ {8}specifier: (.+)$/);
    if (sp && name) {
      spec = unquote(sp[1].trim());
      continue;
    }
    const ver = line.match(/^ {8}version: (.+)$/);
    if (ver && cur && kind && name) {
      importers[cur][kind].push({ name, specifier: spec, version: unquote(ver[1].trim()) });
      name = null;
      spec = null;
    }
  }
  return importers;
}

/** Find one direct declaration in an importer, searching every dependency kind. */
export function findImporterDependency(importers, importer, packageName) {
  const entry = importers[importer];
  if (!entry) return null;
  for (const kind of DEPENDENCY_KINDS) {
    const hit = entry[kind].find((d) => d.name === packageName);
    if (hit) return { kind, ...hit };
  }
  return null;
}

/**
 * Snapshot graph: Map<snapshotKey, ["name@version(peers)", ...]> built from each
 * snapshot's `dependencies` and `optionalDependencies`.
 */
export function parseSnapshots(text) {
  const map = new Map();
  let key = null;
  let inDeps = false;
  for (const line of topLevelSection(lockLines(text), "snapshots:")) {
    const m = line.match(/^ {2}(\S.*?):(?:\s*\{\})?$/);
    if (m) {
      key = unquote(m[1]);
      map.set(key, []);
      inDeps = false;
      continue;
    }
    if (/^ {4}(dependencies|optionalDependencies):$/.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inDeps = false;
    const d = line.match(/^ {6}(\S.*?): (.+)$/);
    if (d && key && inDeps) map.get(key).push(`${unquote(d[1])}@${unquote(d[2].trim())}`);
  }
  return map;
}
