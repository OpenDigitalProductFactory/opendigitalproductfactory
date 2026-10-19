/** Line labels describe character pages: a page can end partway through a line. */
export function sourcePageEndLine(startLine: number, content: string): number {
  return startLine + content.split("\n").length - 1 - (content.endsWith("\n") ? 1 : 0);
}

export function sourcePageNextLine(endLine: number, content: string): number {
  return endLine + (content.endsWith("\n") ? 1 : 0);
}

// One home for the immutable source reader's page bounds (BI-E8237EAE). The
// reader (`read_source_at_version`) serves these, and the governed reviewer's
// argument guard (`terminal-tool-policy`) must accept exactly the same range —
// a second copy of these numbers is how the guard kept refusing pages the
// reader had been raised to serve (BI-8B8731EE, #5079).
export const SOURCE_READ_DEFAULT_MAX_LINES = 200;
export const SOURCE_READ_MAX_LINES = 400;
export const SOURCE_READ_DEFAULT_MAX_CHARS = 12_000;
export const SOURCE_READ_MAX_CHARS = 16_000;
