import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The component imports the "use server" actions module; stub it so the test
// does not pull server-only deps (prisma, next/cache) into jsdom.
vi.mock("@/lib/actions/complaints", () => ({
  createComplaint: vi.fn(),
}));

import { ComplaintsClient } from "./ComplaintsClient";
import type { ComplaintView } from "@/lib/actions/complaints";

const SAMPLE: ComplaintView[] = [
  { id: "C-AAAA1111", customerName: "Sarah Chen", description: "Charged twice for order #4521", severity: "high", category: "Billing", status: "investigating", createdAt: "2026-03-28T14:30:00Z" },
  { id: "C-BBBB2222", customerName: "Lisa Patel", description: "Data export missing February records", severity: "critical", category: "Data", status: "investigating", createdAt: "2026-03-28T11:20:00Z" },
];

describe("ComplaintsClient", () => {
  const html = renderToStaticMarkup(<ComplaintsClient initialComplaints={SAMPLE} />);

  it("renders server-provided complaint rows through DataTable", () => {
    expect(html).toContain("Sarah Chen");
    expect(html).toContain("Lisa Patel");
  });

  it("renders status/severity via token-backed StatusBadge (no raw hex)", () => {
    expect(html).toContain('data-intent="danger"'); // critical severity
    expect(html).toContain('data-intent="accent"'); // investigating status
    expect(html).toMatch(/var\(--dpf-/);
    expect(html).not.toMatch(/#(22c55e|ef4444|eab308|f97316|3b82f6|a855f7|6b7280)/i);
  });

  it("renders the FilterBar status facet", () => {
    expect(html).toContain("Status");
    expect(html).toContain("Investigating");
  });

  it("shows the empty-state message when there are no complaints", () => {
    const emptyHtml = renderToStaticMarkup(<ComplaintsClient initialComplaints={[]} />);
    expect(emptyHtml).toContain("No complaints");
  });
});
