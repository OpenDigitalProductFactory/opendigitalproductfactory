// apps/web/components/shared/MarkdownHtml.tsx
//
// The one place rendered markdown reaches the DOM. renderMarkdown() runs
// markdown-it with raw HTML off and validated link URLs (lib/shared/markdown.ts),
// so the string set here carries no author-supplied markup. No hooks: server
// and client components both use it.

import { renderMarkdown, type RenderMarkdownOptions } from "@/lib/shared/markdown";

type Props = {
  source: string;
  options?: RenderMarkdownOptions;
  className?: string;
  /**
   * Reuse the HTML for a source already rendered with this exact options
   * object (BI-EDE2AF6F). Opt in only when the options are a module constant
   * whose callbacks are pure; a finished coworker message then renders once
   * instead of on every panel re-render.
   */
  memoize?: boolean;
};

const MEMO_LIMIT_PER_OPTIONS = 500;
let memo = new WeakMap<RenderMarkdownOptions, Map<string, string>>();

function renderMemoized(source: string, options: RenderMarkdownOptions): string {
  let bySource = memo.get(options);
  if (!bySource) {
    bySource = new Map();
    memo.set(options, bySource);
  }
  const hit = bySource.get(source);
  if (hit !== undefined) {
    // Refresh recency so the bound evicts the least recently shown message.
    bySource.delete(source);
    bySource.set(source, hit);
    return hit;
  }
  const html = renderMarkdown(source, options);
  bySource.set(source, html);
  if (bySource.size > MEMO_LIMIT_PER_OPTIONS) {
    bySource.delete(bySource.keys().next().value as string);
  }
  return html;
}

/** Test seam: forget every memoized render. */
export function clearMarkdownHtmlMemo(): void {
  memo = new WeakMap();
}

export function MarkdownHtml({ source, options, className, memoize = false }: Props) {
  const html = memoize && options ? renderMemoized(source, options) : renderMarkdown(source, options);
  // Safe: renderMarkdown escapes raw HTML in the source (html: false).
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
