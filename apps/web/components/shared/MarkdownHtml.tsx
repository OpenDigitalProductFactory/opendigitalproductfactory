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
};

export function MarkdownHtml({ source, options, className }: Props) {
  // Safe: renderMarkdown escapes raw HTML in the source (html: false).
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(source, options) }} />;
}
