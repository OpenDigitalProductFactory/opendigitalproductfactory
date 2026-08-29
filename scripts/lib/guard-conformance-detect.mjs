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
export function liveRepoReads(source) {
  const text = blankLiterals(String(source));
  const roots = [...text.matchAll(ROOT_BINDING_RE)].map((match) => match[1]);
  if (roots.length === 0) return [];
  const alternation = roots.join("|");
  const rootRe = new RegExp(String.raw`\b(?:${alternation})\b`);
  const rootCwdRe = new RegExp(String.raw`\bcwd\s*:\s*(?:${alternation})\b`);
  const reads = [];
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
  return reads;
}

/** True when this test file asserts something about the live repository. */
export function isConformanceAssertionSource(source) {
  return liveRepoReads(source).length > 0;
}
