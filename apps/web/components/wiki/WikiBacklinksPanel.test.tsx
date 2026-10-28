import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { WikiBacklinks } from "@/lib/wiki/backlinks";

import { WikiBacklinksPanel } from "./WikiBacklinksPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a className={className} href={href}>{children}</a>
  ),
}));

const empty: WikiBacklinks = { linkedFrom: [], linkedFromCount: 0, unlinkedMentions: [] };

const populated: WikiBacklinks = {
  linkedFromCount: 2,
  linkedFrom: [
    {
      scope: "organization",
      label: "Your organization",
      rows: [
        { id: "a1", slug: "stances/use-csdm", title: "Use CSDM", pageKind: "stance", scope: "organization", href: "/coworker-decisions/stances/use-csdm", context: "We build on the CSDM every time.", via: "this-page" },
      ],
    },
    {
      scope: "platform",
      label: "Platform",
      rows: [
        { id: "k2", slug: "entities/portfolio", title: "Portfolio", pageKind: "entity", scope: "platform", href: "/coworker-decisions/entities/portfolio", context: null, via: "kernel-page" },
      ],
    },
  ],
  unlinkedMentions: [
    { id: "a3", slug: "stances/mentions", title: "Mentions", pageKind: "stance", scope: "organization", href: "/coworker-decisions/stances/mentions", context: "Our CSDM model matters.", linkItHref: "/coworker-decisions/edit/stances/mentions?linkTo=entities%2Fcsdm" },
    { id: "k4", slug: "stances/kernel-mention", title: "Kernel mention", pageKind: "stance", scope: "platform", href: "/coworker-decisions/stances/kernel-mention", context: "The CSDM is canonical.", linkItHref: null },
  ],
};

describe("WikiBacklinksPanel", () => {
  it("shows a plain empty state and nothing more when nothing links or mentions the page", () => {
    const html = renderToStaticMarkup(<WikiBacklinksPanel backlinks={empty} />);
    expect(html).toContain("Linked from");
    expect(html).toContain("No pages link here yet.");
    expect(html).not.toContain("Unlinked mentions");
  });

  it("renders each backlink as a real link with kind, scope and context, grouped by scope", () => {
    const html = renderToStaticMarkup(<WikiBacklinksPanel backlinks={populated} />);
    expect(html).toContain('href="/coworker-decisions/stances/use-csdm"');
    expect(html).toContain("Your organization");
    expect(html).toContain("Platform");
    expect(html).toContain("We build on the CSDM every time.");
    expect(html).toContain("Links the platform page");
    expect(html.indexOf("Your organization")).toBeLessThan(html.indexOf("Portfolio"));
  });

  it("keeps unlinked mentions collapsed, and offers Link it only where the reader may edit", () => {
    const html = renderToStaticMarkup(<WikiBacklinksPanel backlinks={populated} />);
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Unlinked mentions (2)");
    expect(html.match(/Link it/g)).toHaveLength(1);
    expect(html).toContain('href="/coworker-decisions/edit/stances/mentions?linkTo=entities%2Fcsdm"');
  });

  it("uses theme tokens only", () => {
    const html = renderToStaticMarkup(<WikiBacklinksPanel backlinks={populated} />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|text-white|text-black|gray-\d/);
  });
});
