const MAX_SQL_LENGTH = 100_000;
const identifierPart = /[A-Za-z_0-9$\u0080-\uFFFF]/;

/** Remove PostgreSQL comments, preserving quoted bytes and token boundaries.
 * This is normalization only, not a SQL authorization parser. The caller keeps
 * its existing read-only checks. Ordinary strings follow PostgreSQL's default
 * standard_conforming_strings=on; backslash escapes require an E string.
 * https://www.postgresql.org/docs/current/sql-syntax-lexical.html
 */
export function stripSqlComments(sql: string): string {
  if (sql.length > MAX_SQL_LENGTH) throw new Error("SQL exceeds the 100000 character limit.");
  const parts: string[] = [];
  const dollarDelimiter = /(?:\$\$|\$[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9\u0080-\uFFFF]*\$)/y;
  let i = 0;
  let escapeContinuation = false;
  let continuationNewline = false;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith("--", i)) {
      i += 2;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      parts.push(" ");
    } else if (sql.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      let whitespace = " ";
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else {
          if (sql[i] === "\n" || sql[i] === "\r") whitespace += sql[i];
          i++;
        }
      }
      if (depth !== 0) throw new Error("Unterminated SQL block comment.");
      parts.push(whitespace);
      continuationNewline ||= /[\r\n]/.test(whitespace);
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      const escapes: boolean = quote === "'" && ((escapeContinuation && continuationNewline)
        || (/[eE]/.test(sql[start - 1] ?? "")
          && (start < 2 || !identifierPart.test(sql[start - 2]))));
      let closed = false;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === quote) {
          i++;
          if (sql[i] === quote) i++;
          else { closed = true; break; }
        } else i++;
      }
      if (!closed) throw new Error("Unterminated SQL quoted text.");
      parts.push(sql.slice(start, i));
      escapeContinuation = escapes;
      continuationNewline = false;
    } else if (sql[i] === "$" && (i === 0 || !identifierPart.test(sql[i - 1]))) {
      dollarDelimiter.lastIndex = i;
      const delimiter = dollarDelimiter.exec(sql)?.[0];
      if (!delimiter) { escapeContinuation = false; parts.push(sql[i++]); continue; }
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end === -1) throw new Error("Unterminated SQL dollar-quoted text.");
      i = end + delimiter.length;
      parts.push(sql.slice(start, i));
      escapeContinuation = false;
    } else {
      if (sql[i] === "\n" || sql[i] === "\r") continuationNewline = true;
      else if (!/\s/.test(sql[i])) escapeContinuation = false;
      parts.push(sql[i++]);
    }
  }
  return parts.join("").trim();
}
