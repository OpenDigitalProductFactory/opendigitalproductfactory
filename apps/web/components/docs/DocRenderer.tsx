// apps/web/components/docs/DocRenderer.tsx
// Server component — no "use client". Renders on server, zero client JS cost.

import ReactMarkdown from "react-markdown";
import type { ReactNode } from "react";
import { resolveDocLink, slugifyHeading } from "@/lib/docs/doc-link-resolver.mjs";

type C = { children?: ReactNode };

/**
 * Resolve an authored markdown link to the URL the in-portal renderer should
 * use, via the shared resolver that also backs the CI link checker. Passing the
 * page's real sourcePath (not the frontmatter `area`) is what lets cross-area
 * and cross-tree links resolve correctly. Returns the href plus whether it
 * leaves the portal (external or a page only the public site serves).
 */
function resolvePortalLink(href: string | undefined, sourcePath: string): { href: string; external: boolean } {
  if (!href) return { href: "#", external: false };
  const res = resolveDocLink(sourcePath, href);
  switch (res.kind) {
    case "external":
      return { href: res.href, external: true };
    case "anchor":
      return { href: res.anchor ? `#${res.anchor}` : "#", external: false };
    case "internal":
      return { href: res.target.portalHref, external: !res.target.portalOwned };
    case "asset":
      return { href: res.portalHref, external: false };
    case "absolute":
      return { href: res.href, external: res.href.startsWith("http") };
    default:
      return { href: "#", external: false };
  }
}

function buildComponents(sourcePath: string) {
  return {
    h2: ({ children }: C) => (
      <h2
        id={slugifyHeading(String(children))}
        className="text-base font-bold text-[var(--dpf-text)] mt-8 mb-3 pb-1 border-b border-[var(--dpf-border)]"
      >
        {children}
      </h2>
    ),
    h3: ({ children }: C) => (
      <h3
        id={slugifyHeading(String(children))}
        className="text-sm font-semibold text-[var(--dpf-text)] mt-6 mb-2"
      >
        {children}
      </h3>
    ),
    h4: ({ children }: C) => (
      <h4
        id={slugifyHeading(String(children))}
        className="text-sm font-semibold text-[var(--dpf-muted)] mt-4 mb-2"
      >
        {children}
      </h4>
    ),
    p: ({ children }: C) => (
      <p className="text-sm text-[var(--dpf-text)] leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }: C) => (
      <ul className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }: C) => (
      <ol className="text-sm text-[var(--dpf-text)] mb-3 ml-4 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }: C) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }: C) => (
      <strong className="font-semibold text-[var(--dpf-text)]">{children}</strong>
    ),
    a: ({ href, children }: C & { href?: string }) => {
      const { href: resolved, external } = resolvePortalLink(href, sourcePath);
      return (
        <a
          href={resolved}
          className="text-[var(--dpf-accent)] hover:underline"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {children}
        </a>
      );
    },
    code: ({ children, className }: C & { className?: string }) => {
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
    table: ({ children }: C) => (
      <div className="overflow-x-auto mb-3">
        <table className="text-xs w-full border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }: C) => (
      <th className="text-left px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]">
        {children}
      </th>
    ),
    td: ({ children }: C) => (
      <td className="px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-muted)]">
        {children}
      </td>
    ),
    hr: () => <hr className="border-t border-[var(--dpf-border)] my-6" />,
  };
}

export function DocRenderer({ content, sourcePath }: { content: string; sourcePath: string }) {
  return (
    <div className="docs-content">
      <ReactMarkdown components={buildComponents(sourcePath)}>{content}</ReactMarkdown>
    </div>
  );
}
