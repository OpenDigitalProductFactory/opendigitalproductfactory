#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S4 — CI ratchet: no NEW local canonical-JSON serializer.
 *
 * Canonical (sorted-key) JSON feeds hashes, HMAC signatures, receipts, evidence
 * digests and idempotency keys. It had been hand-rolled in 40 files, and the
 * copies disagree: key order by `localeCompare` or by code unit, `undefined`
 * dropped or written as the literal text `undefined` or thrown on, objects
 * rebuilt (which moves integer-like keys such as "2" ahead of "10"), Dates
 * turned into ISO strings or into `{}`. Each import boundary now has one home:
 *
 *   TypeScript (apps/web, packages/*)
 *     import { canonicalJson } from "@dpf/integration-shared/canonical-json";
 *   plain-Node scripts (scripts/**)
 *     import { canonicalJson } from "./lib/canonical-json.mjs";
 *
 * The two homes are byte-identical (packages/integration-shared/src/
 * canonical-json.test.ts proves it).
 *
 * ALLOWLIST holds the copies that stay, each with the exact way its output
 * differs from the home. None is byte-identical to it, and each one's output is
 * persisted, signed or compared across versions, so switching it would change a
 * live hash. It is closed: a new copy imports the home for its boundary instead.
 * Migrating an entry is a per-call-site decision that needs a migration note
 * for whatever it hashed (BI-2F318FB3).
 *
 * What counts as a local canonicaliser (comments and string contents ignored):
 *   1. a named function or arrow that sorts object keys
 *      (`Object.keys(..).sort(` / `Object.entries(..).sort(`), refers to
 *      itself (walks nested values) and produces JSON — it calls
 *      JSON.stringify, or the file calls `JSON.stringify(<walker>(…))`; or
 *   2. `JSON.stringify(value, <replacer>)` whose replacer sorts object keys,
 *      e.g. `JSON.stringify(v, Object.keys(v).sort())`.
 * A one-level sort for a report or a file on disk is not flagged.
 *
 * Scope (source only; tests, fixtures and build output excluded):
 * apps/, packages/, scripts/ and services/.
 *
 * Run: node scripts/check-no-local-canonical-json.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The sanctioned homes, one per import boundary — never flagged.
export const CANONICAL = new Set([
  "packages/integration-shared/src/canonical-json.ts",
  "scripts/lib/canonical-json.mjs",
]);

export const SCAN_ROOTS = ["apps", "packages", "scripts", "services"];

const SELF = new Set([
  "scripts/check-no-local-canonical-json.mjs",
]);

// Closed exceptions. Each reason states how the copy's output differs from the
// home (keys sorted by code unit, `undefined` dropped in objects and `null`
// elsewhere, JSON.stringify numbers, Date walked as `{}`, bigint throws) and
// what it protects. "localeCompare" means the ICU default-locale order, so "a"
// before "B" and "é" before "f"; "rebuilt" means the copy rebuilds each object
// and calls JSON.stringify, so integer-like keys come first in numeric order,
// a top-level `undefined` returns undefined and a Date becomes its ISO string.
// Do NOT add entries: import the home for your boundary.
export const ALLOWLIST = new Map([
  // ---- apps/web ---------------------------------------------------------
  ["apps/web/lib/build/build-artifact-provenance.ts",
    "localeCompare, rebuilt; digests accepted build artifact values (valueDigest) that are persisted with the build record"],
  ["apps/web/lib/build/epic-decomposition-invariants.ts",
    "JSON.stringify replacer, code-unit sort, rebuilt (integer-like keys numeric-first, Date as ISO); in-memory equality only, not persisted — a switch candidate"],
  ["apps/web/lib/coworker/authorized-surface-compiler.ts",
    "localeCompare, rebuilt; surface contract, authority and node digests compared between surface revisions (not a DB column) — a switch candidate once session lifetime is checked"],
  ["apps/web/lib/decision/decision-chain.ts",
    "code-unit sort but rebuilt (integer-like keys numeric-first, top-level undefined not a string); seals the persisted decision hash chain (chainEntryHash) and evidence digests"],
  ["apps/web/lib/ea/data-model-mirror.ts",
    "JSON.stringify replacer, code-unit sort, rebuilt (integer-like keys numeric-first, Date as ISO); EA mirror element descriptor stored on the element and compared on every reconcile, so a switch rewrites every row once"],
  ["apps/web/lib/gates/gate-run-identity.ts",
    "localeCompare; undefined in objects written as the text undefined, in arrays as an empty slot; persisted gate key (gateKey) derived from the gate-run identity digest"],
  ["apps/web/lib/govern/authority/coworker-authority-decision.ts",
    "localeCompare, rebuilt; inputFingerprint binds a persisted approval to the exact call arguments"],
  ["apps/web/lib/govern/authority/policy-authority-projector.ts",
    "localeCompare, rebuilt, Date as ISO string; auditEvidenceDigest in the authority projection's audit evidence"],
  ["apps/web/lib/govern/data/control-operation-domain.ts",
    "code-unit sort, but throws on undefined anywhere (the home drops or nulls it); persisted data-control operation envelopeHash"],
  ["apps/web/lib/governance/reconcile-keyed-findings.ts",
    "localeCompare, rebuilt; compares a stored finding JSON blob with a freshly derived one"],
  ["apps/web/lib/hive/result-intake.ts",
    "code-unit sort; undefined in objects written as the text undefined, in arrays as an empty slot, top-level returns undefined; persisted Hive payloadHash"],
  ["apps/web/lib/inference/data-screening/classify-payload.ts",
    "localeCompare, rebuilt; screening receipt inputHash (screenId, classificationVersion) compared by the inference dispatch guard"],
  ["apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
    "localeCompare, rebuilt; in-memory obligation de-duplication key only, not persisted — a switch candidate"],
  ["apps/web/lib/integrations/external-channel-projection.ts",
    "localeCompare with en-US, throws on non-finite numbers and on undefined at top level or in arrays; persisted external-channel payload fingerprint"],
  ["apps/web/lib/integrations/kernel/audit.ts",
    "localeCompare, rebuilt, Date as ISO string, bigint as its decimal string; persisted connector audit argsHash and requestHash"],
  ["apps/web/lib/routing/extract-tool-calls.ts",
    "code-unit sort; undefined written as the text undefined or an empty array slot; in-memory tool-call de-duplication key over parsed JSON, not persisted — a switch candidate"],
  ["apps/web/lib/routing/provider-suitability/compile.ts",
    "localeCompare, rebuilt, then a djb2 string hash; the hash is the provider-suitability policyId (aips-…) that policy rule ids embed"],
  ["apps/web/lib/self-upgrade/promote-script-functional.test-support.ts",
    "test support that signs a fixture envelope as scripts/lib/transition-signing.mjs does for install-state-migration; code-unit sort, undefined kept as null in objects (the home drops the key)"],
  ["apps/web/lib/tak/pattern-observer/fingerprint.ts",
    "code-unit sort, but throws on undefined, non-finite numbers, Dates and other non-plain objects; evidenceFingerprint persisted in capability-need evidenceJson"],
  ["apps/web/lib/tak/runtime-issues.ts",
    "JSON.stringify(obj, Object.keys(obj).sort()): top level only, and the key list also filters nested objects; in-memory loop-detection signature, not persisted — a switch candidate"],
  ["apps/web/lib/tak/work-pattern-experiment-fixture.ts",
    "code-unit sort, but undefined in objects kept as null (the home drops the key); work-pattern fixtureDigest recorded in the experiment manifest and checked against stored fixture artifacts"],
  ["apps/web/lib/teardown/challenge.ts",
    "localeCompare, rebuilt; teardown challenge body, which travels base64url-encoded with its HMAC, so the bytes are never recomputed — a switch candidate"],
  ["apps/web/lib/teardown/signing.ts",
    "localeCompare, rebuilt; HMAC over the teardown envelope, verified by scripts/governed-teardown.mjs"],
  ["apps/web/lib/wiki/enrich-org-corpus.ts",
    "code-unit sort; undefined written as the text undefined or an empty array slot; wiki enrichment sourceKey, the idempotency key of the RawSource upsert"],
  // ---- packages -----------------------------------------------------------
  ["packages/db/scripts/reconcile-catalog-capabilities.ts",
    "code-unit sort but rebuilt (integer-like keys numeric-first); persisted catalogHash, plus a jsonb-vs-source field comparison"],
  ["packages/db/src/edge-action-envelope.ts",
    "code-unit sort, but throws on undefined, non-finite numbers and bigint; Ed25519 signature over the edge action envelope"],
  ["packages/db/src/federated-demand-contract.ts",
    "code-unit sort; undefined written as the text undefined or an empty array slot; federated demand payloadDigest, exchanged between installs"],
  ["packages/db/src/federated-operational-posture-contract.ts",
    "code-unit sort; undefined written as the text undefined or an empty array slot; federated posture payloadDigest, exchanged between installs"],
  ["packages/db/src/founder-shared-portfolio.ts",
    "code-unit sort; undefined written as the text undefined or an empty array slot; in-memory route-attestation de-duplication only, not persisted — a switch candidate"],
  ["packages/integration-shared/src/tool-call-audit.ts",
    "JSON.stringify(record, Object.keys(record).sort()): top level only, and the key list also filters nested objects; persisted tool-call argsHash"],
  // ---- scripts ------------------------------------------------------------
  ["scripts/apply-runtime-capability-transition.mjs",
    "replacer-array top-level sort (nested keys filtered) for the transition HMAC, plus a rebuilt code-unit sort pretty-printed for catalog bytes; runtime transition signatures and catalog hashes"],
  ["scripts/governed-teardown.mjs",
    "localeCompare, rebuilt via JSON.parse round trips, throws on nested undefined; verifies the HMAC made by apps/web/lib/teardown/signing.ts"],
  ["scripts/lib/capability-service-projection.mjs",
    "code-unit sort but rebuilt and pretty-printed with a trailing newline; persisted capability/service projection hashes"],
  ["scripts/lib/ci-build-artifact.mjs",
    "localeCompare, rebuilt; toolchain fingerprint in build artifact receipts compared across runs"],
  ["scripts/lib/ci-evidence-plan.mjs",
    "localeCompare, rebuilt and pretty-printed with a trailing newline; evidence plan file and its digest, compared across runs"],
  ["scripts/lib/ci-evidence-receipt.mjs",
    "localeCompare, rebuilt; compares a stored CI evidence receipt with the expected one"],
  ["scripts/lib/local-ci-stage-receipt.mjs",
    "localeCompare, rebuilt; compares a stored local-CI stage receipt identity with the current one"],
  ["scripts/lib/local-integration-ci.mjs",
    "code-unit sort, but undefined in objects kept as null (the home drops the key); toolchain fingerprint stored in local-CI receipts"],
  ["scripts/lib/platform-substrate-measurements.mjs",
    "code-unit sort but rebuilt and pretty-printed with a trailing newline; committed measurement baseline bytes"],
  ["scripts/lib/transition-signing.mjs",
    "top-level replacer-array sort for most payloads; for install-state-migration a code-unit walk that writes undefined as the text undefined; runtime transition HMAC signatures"],
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];
const SKIPPED_DIRS = new Set([
  "node_modules", ".next", "__snapshots__", "dist", "coverage",
  "generated", "__tests__", "__fixtures__", "fixtures", ".turbo",
]);

/** True for a test, spec or declaration file, which the guard never scans. */
export function isExcludedFile(name) {
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts")) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  return !SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/**
 * Blank out comments and the contents of string, template and regex literals,
 * keeping every newline and every character offset, so a pattern inside a
 * comment or a string never matches. Template `${…}` expressions stay code.
 */
export function maskSource(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  let lastSignificant = "";
  const templateDepths = []; // brace depth at which each open `${` returns to its template
  let braceDepth = 0;
  const scanTemplate = () => {
    // at a template body position; returns when the template closes or a `${` opens
    const start = i;
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { blank(start, i); i++; lastSignificant = "`"; return; }
      if (c === "$" && source[i + 1] === "{") {
        blank(start, i);
        i += 2;
        templateDepths.push(braceDepth);
        braceDepth++;
        lastSignificant = "{";
        return;
      }
      i++;
    }
    blank(start, i);
  };
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, source.length));
      i = j + 1;
      lastSignificant = c;
      continue;
    }
    if (c === "`") {
      i++;
      scanTemplate();
      continue;
    }
    if (c === "/" && (REGEX_PRECEDERS.has(lastSignificant) || /\b(?:return|typeof|case|in|of)\s*$/.test(source.slice(Math.max(0, i - 8), i)))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = "/";
      continue;
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      braceDepth--;
      if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braceDepth) {
        templateDepths.pop();
        i++;
        scanTemplate();
        continue;
      }
    }
    if (!/\s/.test(c)) lastSignificant = /[A-Za-z0-9_$)\]]/.test(c) ? "a" : c;
    i++;
  }
  return out.join("");
}

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = new Set([")", "]", "}"]);

/** Index just past the bracket that closes the one at `start` (masked code). */
function matchBracket(code, start) {
  const stack = [];
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (CLOSE.has(c)) {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/** End of an arrow's expression body: a depth-0 `;`, closing bracket or comma, or line end. */
function expressionEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && (c === ";" || c === ",")) return i;
    else if (depth === 0 && c === "\n") {
      const rest = code.slice(i + 1).match(/^\s*(\S)/);
      if (!rest || !/[?:.&|+\-*/)\]}]/.test(rest[1])) return i;
    }
  }
  return code.length;
}

const KEY_SORT = /Object\.(?:keys|entries)\s*\(/g;

/** True when `text` sorts the keys of an object: Object.keys/entries(...) … .sort( */
export function sortsObjectKeys(text) {
  KEY_SORT.lastIndex = 0;
  let match;
  while ((match = KEY_SORT.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(text, open);
    if (close === -1) continue;
    // allow an optional .filter(...) / .map(...) between the key list and the sort
    let i = close;
    for (;;) {
      const tail = text.slice(i).match(/^\s*\.\s*(sort|filter|map)\s*\(/);
      if (!tail) break;
      if (tail[1] === "sort") return true;
      const next = matchBracket(text, i + tail[0].length - 1);
      if (next === -1) break;
      i = next;
    }
  }
  return false;
}

const FUNCTION_DECL = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g;
const CONST_DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*?)?=\s*(?=async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g;

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

/** [{ name, start, bodyStart, bodyEnd }] for every named function and function-valued const. */
function namedFunctions(code) {
  const found = [];
  FUNCTION_DECL.lastIndex = 0;
  let m;
  while ((m = FUNCTION_DECL.exec(code)) !== null) {
    const paramsEnd = matchBracket(code, m.index + m[0].length - 1);
    if (paramsEnd === -1) continue;
    const braceAt = code.indexOf("{", paramsEnd);
    if (braceAt === -1) continue;
    const bodyEnd = matchBracket(code, braceAt);
    if (bodyEnd === -1) continue;
    found.push({ name: m[1], start: m.index, bodyStart: braceAt, bodyEnd });
  }
  CONST_DECL.lastIndex = 0;
  while ((m = CONST_DECL.exec(code)) !== null) {
    let i = m.index + m[0].length;
    const rest = code.slice(i);
    if (/^function\b/.test(rest)) {
      const paren = code.indexOf("(", i);
      const paramsEnd = matchBracket(code, paren);
      const braceAt = paramsEnd === -1 ? -1 : code.indexOf("{", paramsEnd);
      const bodyEnd = braceAt === -1 ? -1 : matchBracket(code, braceAt);
      if (bodyEnd !== -1) found.push({ name: m[1], start: m.index, bodyStart: braceAt, bodyEnd });
      continue;
    }
    if (/^async\b/.test(rest)) i += rest.match(/^async\s*/)[0].length;
    if (code[i] === "(") {
      const paramsEnd = matchBracket(code, i);
      if (paramsEnd === -1) continue;
      i = paramsEnd;
    } else {
      const ident = code.slice(i).match(/^[A-Za-z_$][\w$]*/);
      if (!ident) continue;
      i += ident[0].length;
    }
    const arrow = code.slice(i).match(/^\s*(?::[^=;{]*?)?=>\s*/);
    if (!arrow) continue;
    i += arrow[0].length;
    const bodyEnd = code[i] === "{" ? matchBracket(code, i) : expressionEnd(code, i);
    if (bodyEnd === -1) continue;
    found.push({ name: m[1], start: m.index, bodyStart: i, bodyEnd });
  }
  return found;
}

/** Top-level comma-separated arguments of the call whose `(` is at `open`. */
function callArguments(code, open) {
  const close = matchBracket(code, open);
  if (close === -1) return [];
  const args = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close - 1; i++) {
    const c = code[i];
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) depth--;
    else if (c === "," && depth === 0) {
      args.push(code.slice(from, i));
      from = i + 1;
    }
  }
  args.push(code.slice(from, close - 1));
  return args;
}

/**
 * Every local canonicaliser in `source`: [{ line, text, kind }].
 * kind "recursive" — a named walker that sorts object keys and refers to itself;
 * kind "replacer"  — JSON.stringify with a key-sorting replacer.
 */
export function findCanonicalizers(source) {
  const code = maskSource(source);
  const lines = source.split(/\r?\n/);
  const hits = [];
  for (const fn of namedFunctions(code)) {
    const body = code.slice(fn.bodyStart, fn.bodyEnd);
    if (!sortsObjectKeys(body)) continue;
    const name = fn.name.replace(/\$/g, "\\$");
    if (!new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(body)) continue;
    // It must produce JSON: stringify inside the walker, or JSON.stringify(walker(...)).
    // A recursive key sort that renders Markdown or collects probes is not a serializer.
    const producesJson = /\bJSON\.stringify\s*\(/.test(body)
      || new RegExp(`\\bJSON\\.stringify\\s*\\(\\s*${name}\\s*\\(`).test(code);
    if (!producesJson) continue;
    const line = lineOf(code, fn.start);
    hits.push({ line, text: lines[line - 1].trim(), kind: "recursive" });
  }
  const stringify = /\bJSON\.stringify\s*\(/g;
  let m;
  while ((m = stringify.exec(code)) !== null) {
    const args = callArguments(code, m.index + m[0].length - 1);
    if (args.length >= 2 && sortsObjectKeys(args[1])) {
      const line = lineOf(code, m.index);
      hits.push({ line, text: lines[line - 1].trim(), kind: "replacer" });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    // Skip excluded names BEFORE stat: a dangling node_modules link in a
    // worktree throws ENOENT on stat.
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && !isExcludedFile(entry)) yield full;
  }
}

/** Scan SCAN_ROOTS under `root`; return canonicalisers outside the homes and allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    const scanDir = join(root, scanRoot);
    if (!existsSync(scanDir)) continue;
    for (const file of walk(scanDir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (CANONICAL.has(rel) || SELF.has(rel) || ALLOWLIST.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const hit of findCanonicalizers(body)) violations.push({ file: rel, ...hit });
    }
  }
  return violations;
}

/** Allowlisted files that no longer hold a canonicaliser — stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findCanonicalizers(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a NEW local canonical-JSON serializer was added (plan 2026-09-08 §10.5 S4).\n");
    console.error("Hashes and signatures need one canonical form. Import the home for your boundary:");
    console.error('  TypeScript  import { canonicalJson } from "@dpf/integration-shared/canonical-json";');
    console.error('  scripts/    import { canonicalJson } from "./lib/canonical-json.mjs";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.kind}]  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error("\nERROR: stale ALLOWLIST entries in scripts/check-no-local-canonical-json.mjs.");
    console.error("These files no longer hold a local canonicaliser; delete their entries:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(
    `✓ No local canonical-JSON serializers outside the ${CANONICAL.size} homes (${ALLOWLIST.size} allowlisted, each with its difference).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
