// EP-WIKI-001 Phase 6a: wiki page body renderer.
// Renders markdown with one wiki-specific extension: `[[slug]]` and
// `[[slug|label]]` tokens become internal links to `/coworker-decisions/<slug>`.
// Other markdown features (headings, lists, code, links, tables) flow through
// the shared renderMarkdown() with theme-aware tokens per AGENTS.md §9.
//
// Server component; no client JS cost.

import { ChevronRight } from "lucide-react";
import { MarkdownHtml } from "@/components/shared/MarkdownHtml";
import type { RenderMarkdownOptions } from "@/lib/shared/markdown";
import type { ReactNode } from "react";

// ─── Markdown component overrides (theme-aware) ─────────────────────────────

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

/** Wikilink target for `[[slug]]` and `[[slug|label]]` (the rule lives in lib/shared/markdown.ts). */
export function wikilinkHref(slug: string): string {
  return `/coworker-decisions/${slug}`;
}

const MARKDOWN_OPTIONS: RenderMarkdownOptions = {
  classes: {
    h1: "text-xl font-semibold text-[var(--dpf-text)] mt-6 mb-3",
    h2: "text-base font-semibold text-[var(--dpf-text)] mt-6 mb-2 pb-1 border-b border-[var(--dpf-border)]",
    h3: "text-sm font-semibold text-[var(--dpf-text)] mt-4 mb-2",
    p: "text-sm text-[var(--dpf-text)] leading-relaxed mb-3",
    ul: "text-sm text-[var(--dpf-text)] mb-3 ml-4 list-disc space-y-1",
    ol: "text-sm text-[var(--dpf-text)] mb-3 ml-4 list-decimal space-y-1",
    li: "text-sm text-[var(--dpf-text)]",
    a: "text-[var(--dpf-accent)] hover:underline",
    code: "text-xs px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border border-[var(--dpf-border)]",
    pre: "text-xs p-3 mb-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] overflow-x-auto",
    blockquote: "border-l-2 border-[var(--dpf-border)] pl-3 my-3 text-[var(--dpf-muted)] italic",
    table: "text-xs w-full border-collapse",
    th: "text-left px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]",
    td: "px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-muted)]",
  },
  tableWrapperClass: "overflow-x-auto mb-3",
  externalLinksInNewTab: true,
  wikilinkHref,
};

// ─── Public component ───────────────────────────────────────────────────────

type WikiBodyRendererProps = { body: string };

export function WikiBodyRenderer({ body }: WikiBodyRendererProps): ReactNode {
  const sections = splitMarkdownSections(body);
  const hasCollapsibleSections = sections.some((section) => section.kind === "section");

  if (!hasCollapsibleSections) {
    return <MarkdownHtml source={body} options={MARKDOWN_OPTIONS} />;
  }

  return (
    <div className="space-y-3">
      {sections.map((section, index) => {
        if (section.kind === "intro") {
          return (
            <MarkdownHtml key={`intro-${index}`} source={section.markdown} options={MARKDOWN_OPTIONS} />
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
              <MarkdownHtml
                className="border-t border-[var(--dpf-border)] px-3 pb-1 pt-3"
                source={section.markdown}
                options={MARKDOWN_OPTIONS}
              />
            )}
          </details>
        );
      })}
    </div>
  );
}
