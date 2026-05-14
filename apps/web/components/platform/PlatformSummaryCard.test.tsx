import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, className, style }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  ),
}));

import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

describe("PlatformSummaryCard", () => {
  it("renders metric provenance next to sourced values", () => {
    const html = renderToStaticMarkup(
      <PlatformSummaryCard
        title="Governance"
        description="Authority overview"
        href="/platform/audit"
        metrics={[
          {
            label: "Temporary delegation grants",
            value: 0,
            provenance: {
              kind: "live-db",
              description: "Count of active unexpired DelegationGrant rows.",
              sourceTable: "DelegationGrant",
            },
          },
        ]}
      />,
    );

    expect(html).toContain('href="/platform/audit"');
    expect(html).toContain("Temporary delegation grants");
    expect(html).toContain(">0<");
    expect(html).toContain('data-source-kind="live-db"');
    expect(html).toContain("Count of active unexpired DelegationGrant rows.");
  });

  it("keeps legacy metrics without provenance rendering unchanged", () => {
    const html = renderToStaticMarkup(
      <PlatformSummaryCard
        title="AI Operations"
        description="Provider routing"
        href="/platform/ai"
        metrics={[{ label: "Providers", value: 21 }]}
      />,
    );

    expect(html).toContain("Providers");
    expect(html).toContain(">21<");
    expect(html).not.toContain("data-source-kind");
  });
});
