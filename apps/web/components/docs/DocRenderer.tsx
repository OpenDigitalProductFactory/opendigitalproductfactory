// apps/web/components/docs/DocRenderer.tsx
// Server component — no "use client". Renders on server, zero client JS cost.

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

/** Resolve relative markdown links against the current area. */
function resolveHref(href: string | undefined, currentArea: string): string {
  if (!href) return "#";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return href;
  return `/docs/${currentArea}/${href.replace(/\.md$/, "")}`;
}

function buildComponents(currentArea: string): Components {
  return {
    h2: ({ children }) => (
      <h2
        id={slugify(String(children))}
        className="text-base font-bold text-[var(--dpf-text)] mt-8 mb-3 pb-1 border-b border-[var(--dpf-border)]"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={slugify(String(children))}
        className="text-sm font-semibold text-[var(--dpf-text)] mt-6 mb-2"
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-sm text-[var(--dpf-text)] leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => (
      <strong className="font-semibold text-[var(--dpf-text)]">{children}</strong>
    ),
    a: ({ href, children }) => (
      <a
        href={resolveHref(href, currentArea)}
        className="text-[var(--dpf-accent)] hover:underline"
        {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    ),
    code: ({ children, className }) => {
      const isBlock = className?.startsWith("language-");
      if (isBlock) {
        return (
          <pre className="text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md p-3 overflow-x-auto mb-3">
            <code>{children}</code>
          </pre>
        );
      }
      return (
        <code className="text-xs bg-[var(--dpf-surface-2)] px-1 py-0.5 rounded">{children}</code>
      );
    },
    table: ({ children }) => (
      <div className="overflow-x-auto mb-3">
        <table className="text-xs w-full border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="text-left px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-muted)]">
        {children}
      </td>
    ),
    hr: () => <hr className="border-t border-[var(--dpf-border)] my-6" />,
  };
}

export function DocRenderer({ content, currentArea }: { content: string; currentArea: string }) {
  return (
    <div className="docs-content">
      <ReactMarkdown components={buildComponents(currentArea)}>{content}</ReactMarkdown>
    </div>
  );
}
