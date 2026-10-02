// scripts/lib/guard-conformance-detect.mjs — static detection of guard self-tests
// that are really CONFORMANCE ASSERTIONS over live repository state (BI-7B249AFE).
//
// `stripSelfTests()` in the pregate preflight removes every `node --test` command
// from the guard profiles, on the theory that a self-test proves the GUARD's logic
// and CI runs it anyway. That theory holds for a test built entirely from inline
// fixtures. It does not hold for a test that reads the real repository and asserts
// something about it: stripping that removes the only check, and the preflight
// reports clean on a tree CI fails deterministically.
//
// The shape is mechanically recognisable. A conformance assertion binds a repo
// root from `import.meta.url` / `process.cwd()` and reads real files through it.
// A unit test does not read through a repo root at all — it hands literal text to
// the exported function under test, or reads from an `mkdtemp` sandbox whose path
// is not derived from the root.
//
// This module is the detector alone. `scripts/check-guard-conformance-marks.mjs`
// is the guard that requires every detected file to carry the registry mark.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A binding that names the REAL repository. `import.meta.url` is the only
// unambiguous signal: `process.cwd()` is also how an embedded fixture script —
// written inside a template literal and executed in a `mkdtemp` sandbox — names
// its own temporary root, which is the opposite of a conformance read.
const ROOT_BINDING_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*(?:fileURLToPath\s*\(\s*import\.meta\.url|import\.meta\.dirname)/g;

// Direct data reads. Spawns are handled separately: spawning the script under
// test is what a UNIT test does, and it almost always points the child at a
// fixture directory, so a bare spawn mentioning the root proves nothing.
const READ_CALL_RE = /\b(readFileSync|readdirSync|existsSync|statSync|globSync)\s*\(/g;

// A spawn is a conformance read only when the child is pointed at the real
// repository, which is visible as `cwd: <rootBinding>`.
const SPAWN_CALL_RE = /\b(execFileSync|spawnSync|execSync)\s*\(/g;

/**
 * Blank the CONTENTS of every string and template literal, keeping the
 * delimiters and the overall length so offsets and paren nesting still line up.
 *
 * Without this the detector reads fixture text as code. Two real cases:
 * `build-docs-staleness.test.mjs` embeds a fake pnpm script inside a template
 * literal whose body says `const root = process.cwd()` — that is the fixture's
 * TEMP root, the opposite of a repository read — and this guard's own test
 * carries a repo-reading sample as a string constant. Both would be reported.
 */
function blankLiterals(source) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char !== '"' && char !== "'" && char !== "`") {
      out += char;
      index += 1;
      continue;
    }
    const quote = char;
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") { cursor += 2; continue; }
      if (source[cursor] === quote) break;
      // A non-template string never spans a newline; treat one as unterminated
      // rather than swallowing the rest of the file.
      if (quote !== "`" && source[cursor] === "\n") break;
      cursor += 1;
    }
    const closed = cursor < source.length && source[cursor] === quote;
    const body = source.slice(index + 1, cursor);
    out += quote + body.replace(/[^\n]/g, " ") + (closed ? quote : "");
    index = closed ? cursor + 1 : cursor;
  }
  return out;
}

/** The parenthesised argument list starting at `open` (the index of its `(`). */
function callText(source, open) {
  let depth = 0;
  for (let index = open; index < source.length && index < open + 2000; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open, open + 2000);
}

/**
 * Reads of live repository state in `source`, as `{ fn, text }`.
 *
 * A read counts only when its own argument list names a binding derived from the
 * repo root. `readFileSync(fixturePath)` inside an `mkdtemp` sandbox does not
 * mention the root binding and is therefore not a conformance read.
 */
export function liveRepoReads(source, options = {}) {
  const raw = String(source);
  const text = blankLiterals(raw);
  const reads = [];

  // Surface 1 (original): a read or spawn routed through a binding derived from
  // `import.meta.url`. Only meaningful when such a binding exists; its absence is
  // NOT a reason to stop looking — see surfaces 2 and 3 (BI-30E3E229).
  const roots = [...text.matchAll(ROOT_BINDING_RE)].map((match) => match[1]);
  if (roots.length > 0) {
    const alternation = roots.join("|");
    const rootRe = new RegExp(String.raw`\b(?:${alternation})\b`);
    const rootCwdRe = new RegExp(String.raw`\bcwd\s*:\s*(?:${alternation})\b`);
    for (const [pattern, accept] of [[READ_CALL_RE, rootRe], [SPAWN_CALL_RE, rootCwdRe]]) {
      for (const match of text.matchAll(pattern)) {
        const open = text.indexOf("(", match.index);
        if (open === -1) continue;
        const call = callText(text, open);
        if (accept.test(call)) {
          reads.push({ fn: match[1], text: call.replace(/\s+/g, " ").slice(0, 160) });
        }
      }
    }
  }

  reads.push(...literalRepoPathReads(raw, text, options));
  reads.push(...importedRegistryAssertions(raw, text));
  return reads;
}

/**
 * Surface 2: a read whose path is a STRING LITERAL naming a file that exists in
 * the repository — `readFileSync(".github/workflows/ci.yml", "utf8")`.
 *
 * The original detector required a root binding and returned early without one,
 * so a test that reads the repo by cwd-relative literal was abandoned before any
 * read was examined. `scripts/ci-policy-guards.test.mjs` does exactly this, twice.
 *
 * A literal path is safe where a bare `process.cwd()` is not: an embedded fixture
 * script names its own temp root dynamically, whereas a literal that resolves to
 * a tracked repo file can only mean the real repository. `exists` is injected so
 * this module's own tests never touch the repository.
 */
export function literalRepoPathReads(raw, blanked, { exists = defaultExists } = {}) {
  const reads = [];
  for (const match of blanked.matchAll(READ_CALL_RE)) {
    const open = blanked.indexOf("(", match.index);
    if (open === -1) continue;
    // Locate the call in the BLANKED text (so a call written inside a fixture
    // string is never matched), then recover the literal from the ORIGINAL —
    // blankLiterals preserves offsets exactly, so the ranges line up.
    const literal = firstStringLiteral(raw, open);
    if (literal === null) continue;
    if (!isRepoRelativePath(literal)) continue;
    if (!exists(literal)) continue;
    reads.push({
      fn: match[1],
      text: `${match[1]}(${JSON.stringify(literal)}) [repo-relative literal]`,
    });
  }
  return reads;
}

/**
 * Surface 3: a conformance assertion made through a MODULE IMPORT rather than a
 * filesystem read. The live repository state is the registry the test imports;
 * no file is read, so a read-call detector cannot see it at all.
 *
 * Deliberately narrow. The shape required is the registry-inventory assertion:
 *   - a binding imported from a repo-relative specifier,
 *   - never invoked as a function (so it is exported DATA, not the unit under test),
 *   - fed to a collection operation (`Object.values(X)`, `X.flat()`, `X.map(`, ...),
 *   - in a file that declares a SCREAMING_CASE module-scope literal array to
 *     compare against.
 *
 * The coarse version of this check — "imports a never-invoked binding and uses
 * deepEqual somewhere" — was measured against the live corpus and flagged 41 of
 * 198 files, mostly ordinary unit tests that import a constant. This form flags
 * one: scripts/ci-policy-guards.test.mjs, the file that produced the false green.
 * Narrow by construction; surface 2 is the broader net.
 */
export function importedRegistryAssertions(raw, blanked) {
  // The inventory literal must be real code, so test the blanked source: a
  // SCREAMING_CASE array written inside a fixture string must not count.
  if (!MODULE_SCOPE_INVENTORY_RE.test(blanked)) return [];
  const hits = [];
  for (const match of blanked.matchAll(NAMED_IMPORT_RE)) {
    const specifier = raw.slice(match.index, match.index + match[0].length).match(RELATIVE_SPECIFIER_RE);
    if (!specifier) continue;
    for (const clause of match[1].split(",")) {
      const name = clause.split(" as ").pop().trim();
      if (!IDENTIFIER_RE.test(name)) continue;
      if (new RegExp(String.raw`\b${name}\s*\(`).test(blanked)) continue; // invoked: unit under test
      if (!collectionUseRe(name).test(blanked)) continue;
      hits.push({
        fn: "import",
        text: `${name} imported from ${specifier[1]} and asserted over as a collection [registry conformance]`,
      });
    }
  }
  return hits;
}

const NAMED_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["'][^"'\n]+["']/g;
const RELATIVE_SPECIFIER_RE = /from\s*["'](\.[^"'\n]+)["']/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const MODULE_SCOPE_INVENTORY_RE = /^const\s+[A-Z][A-Z0-9_]*\s*=\s*\[/m;

const collectionUseRe = (name) =>
  new RegExp(
    String.raw`(?:Object\.(?:values|keys|entries)\s*\(\s*${name}\b|\b${name}\s*\.\s*(?:flat|map|filter)\s*\()`,
  );

/** A path literal that could name a repository file: relative, no escape, no URL. */
function isRepoRelativePath(value) {
  if (value === "" || value.startsWith("/") || value.includes("..")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false; // file:, https:, C:
  return value.includes("/") || /\.[a-z0-9]+$/i.test(value);
}

/**
 * The first argument of the call opening at `open`, when it is a plain string
 * literal. Returns null for a template literal, a binding or an expression.
 */
function firstStringLiteral(raw, open) {
  let index = open + 1;
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  const quote = raw[index];
  if (quote !== '"' && quote !== "'") return null;
  let out = "";
  index += 1;
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") { out += raw[index + 1] ?? ""; index += 2; continue; }
    if (char === quote) return out;
    if (char === "\n") return null;
    out += char;
    index += 1;
  }
  return null;
}

let repoRootCache = null;
function defaultExists(relativePath) {
  if (repoRootCache === null) {
    repoRootCache = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  }
  try {
    return fs.existsSync(path.join(repoRootCache, relativePath));
  } catch {
    return false;
  }
}

/** True when this test file asserts something about the live repository. */
export function isConformanceAssertionSource(source, options = {}) {
  return liveRepoReads(source, options).length > 0;
}
