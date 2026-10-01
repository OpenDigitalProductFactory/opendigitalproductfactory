import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/ops";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { OpsTabNav } from "./OpsTabNav";

function render(path: string) {
  pathname = path;
  return renderToStaticMarkup(<OpsTabNav />);
}

describe("OpsTabNav", () => {
  it("keeps /ops to delivery work: platform upkeep lives under Platform, Updates & health (BI-811C588E)", () => {
    const html = render("/ops");
    for (const href of ["/ops/self-upgrade", "/ops/patches", "/ops/teardown", "/ops/dev-loop", "/ops/security"]) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).toContain(">Requests<");
    expect(html).toContain(">Work in progress<");
  });

  it("does not render the retired Improvements tab (converged into /ops)", () => {
    const html = render("/ops");
    expect(html).not.toContain('href="/ops/improvements"');
  });

  it("marks Work in progress active on /ops/workrooms", () => {
    const html = render("/ops/workrooms");
    const idx = html.indexOf('href="/ops/workrooms"');
    const tag = html.slice(html.lastIndexOf("<a ", idx), html.indexOf(">", idx));
    expect(tag).toContain("border-[var(--dpf-accent)]");
  });

  it("marks Requests tab active only on exact /ops match", () => {
    const html = render("/ops");
    expect(html).toContain("border-[var(--dpf-accent)]");
    // Backlog link tag should have the active class
    const backlogIdx = html.indexOf('href="/ops"');
    const aStart = html.lastIndexOf("<a ", backlogIdx);
    const aEnd = html.indexOf(">", aStart);
    const tag = html.slice(aStart, aEnd);
    expect(tag).toContain("border-b-2");
  });

  it("does not mark Backlog tab active when on /ops/self-upgrade", () => {
    const html = render("/ops/self-upgrade");
    const backlogIdx = html.indexOf('href="/ops"');
    const aStart = html.lastIndexOf("<a ", backlogIdx);
    const aEnd = html.indexOf(">", aStart);
    const tag = html.slice(aStart, aEnd);
    expect(tag).not.toContain("border-b-2");
  });
});
