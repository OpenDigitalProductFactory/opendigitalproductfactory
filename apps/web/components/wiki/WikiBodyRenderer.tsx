// EP-WIKI-001 Phase 6a: wiki page body renderer.
// Renders markdown with one wiki-specific extension: `[[slug]]` and
// `[[slug|label]]` tokens become internal links to `/wiki/<slug>`.
// Other markdown features (headings, lists, code, links) flow through
// react-markdown with theme-aware tokens per AGENTS.md §12.
//
// Server component; no client JS cost.

import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
type MarkdownSection =
  | { kind: "intro"; markdown: string }
  | { kind: "section"; heading: string; markdown: string };

function parseCollapsibleHeading(line: string): string | null {
  const match = line.match(/^\s{0,3}##\s+(.+?)\s*$/);
  if (!match) return null;
  return match[1].replace(/\s+#+$/, "").trim() || null;
}

function trimMarkdownLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

function fenceMarker(line: string): "`" | "~" | null {
  const match = line.match(/^\s*(```+|~~~+)/);
  if (!match) return null;
  return match[1][0] as "`" | "~";
}

export function splitMarkdownSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const introLines: string[] = [];
  let currentSection: { heading: string; lines: string[] } | null = null;
  let activeFence: "`" | "~" | null = null;

  function flushIntro() {
    const markdown = trimMarkdownLines(introLines);
    if (markdown) sections.push({ kind: "intro", markdown });
    introLines.length = 0;
  }

  function flushSection() {
    if (!currentSection) return;
    sections.push({
      kind: "section",
      heading: currentSection.heading,
      markdown: trimMarkdownLines(currentSection.lines),
    });
    currentSection = null;
  }

  for (const line of body.split(/\r?\n/)) {
    const heading = activeFence ? null : parseCollapsibleHeading(line);
    if (heading) {
      if (currentSection) {
        flushSection();
      } else {
        flushIntro();
      }
      currentSection = { heading, lines: [] };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }

    const marker = fenceMarker(line);
    if (!marker) continue;
    if (!activeFence) {
      activeFence = marker;
    } else if (activeFence === marker) {
      activeFence = null;
    }
  }

  flushSection();
  flushIntro();
  return sections;
}

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
  const sections = splitMarkdownSections(body);
  const hasCollapsibleSections = sections.some((section) => section.kind === "section");

  if (!hasCollapsibleSections) {
    return <ReactMarkdown components={components}>{body}</ReactMarkdown>;
  }

  return (
    <div className="space-y-3">
      {sections.map((section, index) => {
        if (section.kind === "intro") {
          return (
            <div key={`intro-${index}`}>
              <ReactMarkdown components={components}>{section.markdown}</ReactMarkdown>
            </div>
          );
        }

        return (
          <details
            key={`${section.heading}-${index}`}
            className="group rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-[var(--dpf-muted)] transition-transform group-open:rotate-90"
              />
              <span className="min-w-0">{section.heading}</span>
            </summary>
            {section.markdown && (
              <div className="border-t border-[var(--dpf-border)] px-3 pb-1 pt-3">
                <ReactMarkdown components={components}>{section.markdown}</ReactMarkdown>
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}
