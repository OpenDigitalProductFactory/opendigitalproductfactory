/** Line labels describe character pages: a page can end partway through a line. */
export function sourcePageEndLine(startLine: number, content: string): number {
  return startLine + content.split("\n").length - 1 - (content.endsWith("\n") ? 1 : 0);
}

export function sourcePageNextLine(endLine: number, content: string): number {
  return endLine + (content.endsWith("\n") ? 1 : 0);
}
