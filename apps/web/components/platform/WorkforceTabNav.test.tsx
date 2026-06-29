import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/platform/ai/readiness";

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

import { WorkforceTabNav } from "@/components/platform/WorkforceTabNav";

describe("WorkforceTabNav", () => {
  it("uses Readiness as the AI front door without adding an Overview peer", () => {
    pathname = "/platform/ai/readiness";
    const html = renderToStaticMarkup(<WorkforceTabNav />);

    const readinessIndex = html.indexOf('href="/platform/ai/readiness"');

    expect(readinessIndex).toBeGreaterThan(-1);
    expect(html).toContain(">Readiness<");
    expect(html).not.toContain(">Overview<");
    expect(html).toContain(">Assignments<");
    expect(html).toContain(">Routing &amp; Calibration<");
    expect(html).toContain(">Skills<");
  });
});
