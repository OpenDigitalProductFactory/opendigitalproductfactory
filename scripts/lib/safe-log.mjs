// scripts/lib/safe-log.mjs
//
// Same CR/LF strip as apps/web/lib/security/safe-log.ts. Scripts run as plain
// Node and cannot import that TypeScript module. CodeQL js/log-injection
// (CWE-117) flags a log line that still contains a raw control character from
// outside the process. Replace C0, DEL, and the Unicode line separators.

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const LOG_UNSAFE_CHARS = /[\x00-\x1f\x7f\u2028\u2029]+/g;

export function sanitizeForLog(value) {
  return String(value).replace(LOG_UNSAFE_CHARS, "_");
}
