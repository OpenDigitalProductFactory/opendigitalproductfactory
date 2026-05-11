// EP-WIKI-001 Phase 6a: wiki page body renderer.
// Renders markdown with one wiki-specific extension: `[[slug]]` and
// `[[slug|label]]` tokens become internal links to `/wiki/<slug>`.
// Other markdown features (headings, lists, code, links) flow through
// react-markdown with theme-aware tokens per AGENTS.md §12.
//
// Server component; no client JS cost.

import ReactMarkdown from "react-markdown";
import Link from "next/link";
import type { ReactNode } from "react";

// ─── Wikilink tokenization ──────────────────────────────────────────────────

type WikilinkPart =
  | { kind: "text"; value: string }
  | { kind: "wikilink"; slug: string; label: string };

/**
 * Split a string into wikilinks and plain-text spans. Pure — exported
 * for testing.
 *
 * Recognises `[[slug]]` (label = slug) and `[[slug|Label here]]`.
 * Slugs may contain `[a-z0-9/_-]`; anything else inside `[[...]]` is
 * left as literal text so we never silently swallow malformed tokens.
 */
export function splitWikilinks(text: string): WikilinkPart[] {
  const parts: WikilinkPart[] = [];
  const regex = /\[\[([a-zA-Z0-9/_-]+)(?:\|([^\]]+))?\]\]/g;
  let lastIndex = 0;
  for (const m of text.matchAll(regex)) {
    if (m.index === undefined) continue;
    if (m.index > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, m.index) });
    }
    const slug = m[1];
    const label = m[2] ?? slug;
    parts.push({ kind: "wikilink", slug, label });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

function renderWikilinkSpans(text: string): ReactNode[] {
  const parts = splitWikilinks(text);
  if (parts.every((p) => p.kind === "text")) return [text];
  return parts.map((p, i) => {
    if (p.kind === "text") return p.value;
    return (
      <Link
        key={i}
        href={`/wiki/${p.slug}`}
        className="text-[var(--dpf-accent)] hover:underline"
      >
        {p.label}
      </Link>
    );
  });
}

// ─── Markdown component overrides (theme-aware) ─────────────────────────────

type C = { children?: ReactNode };
type AnchorC = C & { href?: string };

const components = {
  h1: ({ children }: C) => (
    <h1 className="text-xl font-semibold text-[var(--dpf-text)] mt-6 mb-3">{children}</h1>
  ),
  h2: ({ children }: C) => (
    <h2 className="text-base font-semibold text-[var(--dpf-text)] mt-6 mb-2 pb-1 border-b border-[var(--dpf-border)]">
      {children}
    </h2>
  ),
  h3: ({ children }: C) => (
    <h3 className="text-sm font-semibold text-[var(--dpf-text)] mt-4 mb-2">{children}</h3>
  ),
  p: ({ children }: C) => (
    <p className="text-sm text-[var(--dpf-text)] leading-relaxed mb-3">
      {transformChildren(children)}
    </p>
  ),
  ul: ({ children }: C) => (
    <ul className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: C) => (
    <ol className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: C) => (
    <li className="text-sm text-[var(--dpf-text)]">{transformChildren(children)}</li>
  ),
  a: ({ href, children }: AnchorC) => (
    <a
      href={href ?? "#"}
      className="text-[var(--dpf-accent)] hover:underline"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  ),
  code: ({ children }: C) => (
    <code className="text-xs px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border border-[var(--dpf-border)]">
      {children}
    </code>
  ),
  pre: ({ children }: C) => (
    <pre className="text-xs p-3 mb-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] overflow-x-auto">
      {children}
    </pre>
  ),
  blockquote: ({ children }: C) => (
    <blockquote className="border-l-2 border-[var(--dpf-border)] pl-3 my-3 text-[var(--dpf-muted)] italic">
      {children}
    </blockquote>
  ),
};

/** Walk children and rewrite plain-text `[[wikilink]]` tokens into <Link>s. */
function transformChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return renderWikilinkSpans(children);
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? <span key={i}>{renderWikilinkSpans(c)}</span> : c,
    );
  }
  return children;
}

// ─── Public component ───────────────────────────────────────────────────────

type WikiBodyRendererProps = { body: string };

export function WikiBodyRenderer({ body }: WikiBodyRendererProps): ReactNode {
  return <ReactMarkdown components={components}>{body}</ReactMarkdown>;
}
