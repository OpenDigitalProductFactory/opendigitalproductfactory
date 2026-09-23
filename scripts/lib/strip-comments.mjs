// Strip JS/TS comments so prose ABOUT a pattern is not counted as a USE of it.
//
// BI-6EBA0A00. Guards that grep raw source cannot tell a rule from an
// explanation of the rule. The One-ActionResult ratchet counted three
// documentation comments — all of them teaching the very convention it
// enforces — as three violations, which creates pressure to silently reword
// documentation rather than fix the check. A guard that penalises explaining a
// convention erodes that convention's documentation, which is the opposite of
// what it was built for.
//
// Extracted verbatim from check-no-url-pathname-fs.mjs, which had the only
// sound implementation of the four in scripts/; the other three are regex-based
// and break on `//` inside a string literal. This is the single home so a fifth
// is never written.
//
// Deliberately LEXICAL, not a parser. It handles line comments, block comments
// and the three string-literal forms, and copies literals verbatim so a `//`
// inside one is not read as a comment. It does not track regex literals, so a
// regex containing `//` can still mis-strip; that shape is not one this repo
// has, and the alternative is a parser in a guard.
//
// Line structure is PRESERVED — block comments become runs of spaces and line
// comments stop at the newline — so a finding still reports the real line
// number of the surviving code.

/**
 * @param {string} source
 * @returns {string} the source with comment text removed, line numbers intact
 */
export function stripComments(source) {
  let out = "";
  let index = 0;
  const text = String(source);
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    if (two === "//") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (two === "/*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(index, end).replace(/[^\n]/g, " ");
      index = end;
      continue;
    }
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      // Copy the literal verbatim so a `//` inside it is not read as a comment.
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") { cursor += 2; continue; }
        if (text[cursor] === char) break;
        if (char !== "`" && text[cursor] === "\n") break;
        cursor += 1;
      }
      const end = Math.min(cursor + 1, text.length);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}
