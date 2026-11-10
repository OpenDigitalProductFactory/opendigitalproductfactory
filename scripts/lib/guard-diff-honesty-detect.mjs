// scripts/lib/guard-diff-honesty-detect.mjs — static detection of diff-scoped
// guards that swallow a failed `git` invocation into an empty change set.
//
// WHY THIS DETECTOR EXISTS. `git diff <base>...HEAD` exits 128 with EMPTY stdout
// when the base cannot be resolved (shallow clone, absent origin/main, refs with
// no merge base). A guard whose git wrapper collapses a non-zero exit into `""`
// then reads "no files changed" and prints its clean line — a pass from a guard
// that never saw the change.
//
// The class has been closed by hand four times: BI-20599979, BI-B6433DC6, the
// ten-guard sweep in PR #4886, and the two `--diff-filter=AM` holdouts that
// sweep missed (BI-FACB7C05) even while its commit message claimed every
// remaining diff-scoped guard had been converted. Hand-picking does not close a
// class — the same lesson `check-guard-conformance-marks.mjs` records for its
// own. This module recognises the shape statically so the next one cannot land.
//
// THE SHAPE. Two independent signals, both required:
//
//   1. A git wrapper whose `catch` returns stdout-or-empty rather than
//      distinguishing failure. `scripts/lib/git-changed-files.mjs` is the honest
//      counterpart: it returns `{ ok, stdout, stderr }` and its callers branch
//      on `status === "unresolvable"`.
//   2. A three-dot range against HEAD, the construct that fails this way. A
//      guard that swallows git but never diffs a range is out of scope.
//
// WHY A REAL SCANNER AND NOT REGEXES OVER RAW TEXT. Two traps, both hit while
// building this:
//
//   • A guard that merely DESCRIBES the anti-pattern in a comment — as every
//     converted guard now does, this file included — must not be reported. So
//     comments are blanked before the swallow is looked for.
//   • `check-test-clock-bombs.mjs` carries `/["'`]\d{4}-…/`: a REGEX literal
//     containing a double quote, a single quote AND a backtick. A scanner that
//     only knows strings reads that quote as a string start and desynchronises
//     for the rest of the file — every later construct, including the catch
//     block being hunted, silently disappears. That is exactly the
//     false-NEGATIVE this guard exists to prevent, so the scanner understands
//     regex literals.
//
// The range and the swallow are read from DIFFERENT projections: the range
// normally lives inside a template literal (`${base}...HEAD`), so blanking
// strings would hide it, while the swallow must be read with strings blanked so
// sample code carried as text is not mistaken for code.
//
// This module is the detector alone. `scripts/check-guard-diff-honesty.mjs` is
// the guard that fails on what it finds.

/** Opt-out for a call the detector cannot judge. Stated, never silent. */
export const ALLOW_MARKER_RE = /diff-honesty:\s*allow\b/;

// A `catch` whose body hands back stdout or an empty string. Covers the three
// spellings that were actually in the tree:
//   return (e.stdout && e.stdout.toString()) || "";
//   return error.stdout?.toString() ?? "";
//   return "";
const SWALLOW_RETURN_RE =
  /\breturn\s+(?:[^;]*\bstdout\b[^;]*|["'`]\s*["'`])\s*;/;

/** The construct that fails with empty stdout when there is no merge base. */
const THREE_DOT_RANGE_RE = /\.\.\.\s*HEAD\b/g;

// The range must belong to a `git diff`, not to any three-dot range.
// `scripts/pr-readiness.mjs` computes `rev-list --left-right --count
// <upstream>...HEAD` for an ahead/behind pair: that range fails the same way,
// but an empty result there is not a claim about which files changed, so it
// cannot produce the false pass this guard is about. Requiring `diff` in the
// SAME call keeps the report to the reads that decide a verdict.
const DIFF_ARG_RE = /["'`]diff["'`]/;

/** A wrapper only matters when it is actually wrapping git. */
const GIT_SPAWN_RE = /\b(?:execFileSync|spawnSync|execSync)\s*\(\s*["'`]git["'`]/;

// A guard that fails closed on the base somewhere has ESTABLISHED it, and a
// swallowing range read afterwards can no longer produce a false pass — the run
// has already exited if the base was unresolvable.
//
// This distinction is load-bearing, not a convenience. Several converted guards
// legitimately keep a local `git()` wrapper for follow-up reads (rename
// detection, --diff-filter=A passes) AFTER `exitUnresolvable` has proven the
// base. Without this the guard would report every one of them and the class
// would look unfixable; with it, the report is exactly the files where a
// swallowed range decides the verdict.
const ESTABLISHES_BASE_RE = /\b(?:exitUnresolvable|requireChangedFiles)\s*\(/;

// After one of these, a `/` starts a REGEX literal rather than a division.
// Anything else (an identifier, a closing paren/bracket, a number) means the
// `/` is division, which needs no special handling.
const REGEX_ALLOWED_AFTER = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*",
  "%", "~", "^", "<", ">", "\n",
]);
const REGEX_ALLOWED_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

/**
 * Scan `source` once into spans, classifying each as code, comment, string or
 * regex. One pass so the projections below can never disagree about where a
 * construct begins.
 *
 * @param {string} source
 * @returns {{kind: "code"|"comment"|"string"|"regex", start: number, end: number}[]}
 */
export function scanSpans(source) {
  const text = String(source);
  const spans = [];
  let index = 0;
  let codeStart = 0;

  const pushCode = (end) => {
    if (end > codeStart) spans.push({ kind: "code", start: codeStart, end });
  };

  /** The last non-whitespace code character before `at`, and the word it ends. */
  const prevSignificant = (at) => {
    let i = at - 1;
    while (i >= 0 && /[ \t]/.test(text[i])) i -= 1;
    if (i < 0) return { char: "\n", word: "" };
    let word = "";
    if (/[\w$]/.test(text[i])) {
      let j = i;
      while (j >= 0 && /[\w$]/.test(text[j])) j -= 1;
      word = text.slice(j + 1, i + 1);
    }
    return { char: text[i], word };
  };

  while (index < text.length) {
    const two = text.slice(index, index + 2);

    if (two === "//") {
      pushCode(index);
      const nl = text.indexOf("\n", index);
      const end = nl === -1 ? text.length : nl;
      spans.push({ kind: "comment", start: index, end });
      index = end;
      codeStart = index;
      continue;
    }

    if (two === "/*") {
      pushCode(index);
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      spans.push({ kind: "comment", start: index, end });
      index = end;
      codeStart = index;
      continue;
    }

    const char = text[index];

    if (char === '"' || char === "'" || char === "`") {
      pushCode(index);
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") { cursor += 2; continue; }
        if (text[cursor] === char) break;
        // A non-template string never spans a newline; treat one as
        // unterminated rather than swallowing the rest of the file.
        if (char !== "`" && text[cursor] === "\n") break;
        cursor += 1;
      }
      const closed = cursor < text.length && text[cursor] === char;
      const end = closed ? cursor + 1 : cursor;
      spans.push({ kind: "string", start: index, end });
      index = end;
      codeStart = index;
      continue;
    }

    if (char === "/") {
      const { char: prevChar, word } = prevSignificant(index);
      const isRegex = REGEX_ALLOWED_KEYWORDS.has(word) || REGEX_ALLOWED_AFTER.has(prevChar);
      if (isRegex) {
        pushCode(index);
        let cursor = index + 1;
        let inClass = false;
        while (cursor < text.length) {
          const c = text[cursor];
          if (c === "\\") { cursor += 2; continue; }
          if (c === "\n") break; // unterminated; bail rather than run away
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          cursor += 1;
        }
        const closed = cursor < text.length && text[cursor] === "/";
        // Include trailing flags so `i`/`g` are not read as code.
        let end = closed ? cursor + 1 : cursor;
        while (end < text.length && /[a-z]/.test(text[end])) end += 1;
        spans.push({ kind: "regex", start: index, end });
        index = end;
        codeStart = index;
        continue;
      }
    }

    index += 1;
  }
  pushCode(text.length);
  return spans;
}

/**
 * Rebuild `source` with the CONTENTS of the named span kinds replaced by
 * spaces. Newlines are preserved so line numbers and offsets still line up.
 *
 * @param {string} source
 * @param {("comment"|"string"|"regex")[]} kinds
 */
export function blankSpans(source, kinds) {
  const text = String(source);
  const blank = new Set(kinds);
  let out = "";
  for (const span of scanSpans(text)) {
    const slice = text.slice(span.start, span.end);
    if (span.kind === "code" || !blank.has(span.kind)) {
      out += slice;
      continue;
    }
    if (span.kind === "string") {
      // Keep the delimiters so the result still parses as a string position.
      const quote = slice[0];
      const closed = slice.length > 1 && slice.at(-1) === quote;
      const body = slice.slice(1, closed ? -1 : undefined);
      out += quote + body.replace(/[^\n]/g, " ") + (closed ? quote : "");
      continue;
    }
    out += slice.replace(/[^\n]/g, " ");
  }
  return out;
}

/**
 * The argument list of the innermost call enclosing `index`, found by walking
 * back to the unbalanced `(`. Returns "" when `index` is not inside a call.
 */
function enclosingCall(source, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const char = source[i];
    if (char === ")") depth += 1;
    else if (char === "(") {
      if (depth === 0) {
        // Found the opening paren; now take the whole balanced call text.
        let d = 0;
        for (let j = i; j < source.length; j += 1) {
          if (source[j] === "(") d += 1;
          else if (source[j] === ")") {
            d -= 1;
            if (d === 0) return source.slice(i, j + 1);
          }
        }
        return source.slice(i);
      }
      depth -= 1;
    }
  }
  return "";
}

/** True when some `…...HEAD` range in `source` sits inside a `git diff` call. */
function hasDiffRange(source) {
  THREE_DOT_RANGE_RE.lastIndex = 0;
  for (const match of source.matchAll(THREE_DOT_RANGE_RE)) {
    if (DIFF_ARG_RE.test(enclosingCall(source, match.index))) return true;
  }
  return false;
}

/**
 * Every `catch (…) { … }` body in `source`, as `{ body, line }`.
 * Brace-matched rather than regexed, so a nested block does not truncate it.
 */
function catchBodies(source) {
  const bodies = [];
  const re = /\bcatch\b\s*(?:\([^)]*\))?\s*\{/g;
  for (const match of source.matchAll(re)) {
    const open = source.indexOf("{", match.index);
    if (open === -1) continue;
    let depth = 0;
    let close = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    bodies.push({
      body: source.slice(open, close + 1),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return bodies;
}

/**
 * Findings for one guard source: the swallowing catch blocks, but only when the
 * file also spawns git AND diffs a three-dot range against HEAD.
 *
 * Returns `[]` for an honest guard, for a guard that never diffs a range, and
 * for one carrying the allow marker.
 *
 * @param {string} source
 * @returns {{line: number, snippet: string}[]}
 */
export function findDiffSwallows(source) {
  const text = String(source);
  if (ALLOW_MARKER_RE.test(text)) return [];

  // Ranges: strings INTACT (the range lives in a template literal), comments and
  // regexes blanked so prose and pattern text cannot supply one.
  const forRanges = blankSpans(text, ["comment", "regex"]);
  if (!hasDiffRange(forRanges)) return [];
  if (!GIT_SPAWN_RE.test(forRanges)) return [];

  // Swallows: everything that is not executable code blanked.
  const code = blankSpans(text, ["comment", "string", "regex"]);
  if (ESTABLISHES_BASE_RE.test(code)) return [];

  const findings = [];
  for (const { body, line } of catchBodies(code)) {
    if (!SWALLOW_RETURN_RE.test(body)) continue;
    findings.push({ line, snippet: body.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return findings;
}

/** True when this guard swallows a failed diff into an empty change set. */
export function swallowsDiffFailure(source) {
  return findDiffSwallows(source).length > 0;
}
