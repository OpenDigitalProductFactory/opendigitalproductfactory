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
  it("renders a Self-upgrade tab linking to /ops/self-upgrade", () => {
    const html = render("/ops");
    expect(html).toContain('href="/ops/self-upgrade"');
    expect(html).toContain(">Self-upgrade<");
  });

  it("marks Self-upgrade tab active when pathname is /ops/self-upgrade", () => {
    const html = render("/ops/self-upgrade");
    expect(html).toContain("border-[var(--dpf-accent)]");
  });

  it("marks Self-upgrade tab active on sub-routes of /ops/self-upgrade", () => {
    const html = render("/ops/self-upgrade/history");
    expect(html).toContain("border-[var(--dpf-accent)]");
  });

  it("does not mark Self-upgrade tab active on /ops", () => {
    const html = render("/ops");
    // Only Backlog should be active — extract the class for the self-upgrade link
    const selfUpgradeIdx = html.indexOf('href="/ops/self-upgrade"');
    // Walk back to find the opening <a
    const aStart = html.lastIndexOf("<a ", selfUpgradeIdx);
    const aEnd = html.indexOf(">", aStart);
    const tag = html.slice(aStart, aEnd);
    expect(tag).not.toContain("border-b-2");
  });

  it("marks Backlog tab active only on exact /ops match", () => {
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
