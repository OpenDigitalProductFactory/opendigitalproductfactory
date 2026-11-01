import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/components/ui/report-kit/Chart", () => ({ Chart: () => <div /> }));
import { PerformanceTrendPanel } from "./PerformanceTrendPanel";
it("keeps recorded currency and a missing historical point in its native table", () => {
  const html = renderToStaticMarkup(<PerformanceTrendPanel points={[
    { periodKey: "2026-09", periodLabel: "Sep 2026", values: { income: null } },
    { periodKey: "2026-10", periodLabel: "Oct 2026", values: { income: 1200 } },
  ]} metrics={[{ key: "income", label: "Posted income", unit: "currency", currency: "EUR" }]} preferredKeys={["income"]} />);
  expect(html).toContain("€1,200.00"); expect(html).toContain("Not available"); expect(html).not.toContain("$1,200.00");
});
