// @vitest-environment jsdom
import { DEFAULT_LOCALE, translate } from "@dpf/i18n";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), can: vi.fn(), context: vi.fn(), report: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: any) => translate(DEFAULT_LOCALE, "shell", key) }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: m.actor }));
vi.mock("@/lib/permissions", () => ({ can: m.can }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/performance/performance-organization-context", () => ({ resolvePerformanceOrganizationContext: m.context }));
vi.mock("@/lib/finance/ledger-service", () => ({ getGeneralLedgerReport: m.report }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
import Page from "./page";
beforeEach(() => {
  vi.resetAllMocks(); m.actor.mockResolvedValue({ userId: "owner", platformRole: "HR-000", platformRoles: ["HR-000"], isSuperuser: false }); m.auth.mockResolvedValue({ user: { id: "owner", platformRole: "HR-000" } }); m.can.mockReturnValue(true);
  m.context.mockResolvedValue({ status: "resolved", organizationId: "org-a", archetypeId: "software-platform" });
  m.report.mockResolvedValue({ availability: "unavailable", reason: "No recorded entries", periodKey: "2026-10", currency: null });
});
it.each(["2026-13", "", ["2026-10", "2026-11"], "all"])("malformed selection %j never becomes all-recorded", async period => {
  await Page({ searchParams: Promise.resolve({ period }) });
  expect(m.report).not.toHaveBeenCalled();
});
it("explicit missing period retains all-recorded with current scope", async () => {
  await Page({ searchParams: Promise.resolve({}) });
  expect(m.report).toHaveBeenCalledWith("org-a", null);
});
it("exact month is preserved and URL organization cannot override current scope", async () => {
  await Page({ searchParams: Promise.resolve({ period: "2026-10", organizationId: "org-b" } as { period: string }) });
  expect(m.report).toHaveBeenCalledWith("org-a", "2026-10");
});
it("unauthenticated visitors cannot read financial records", async () => {
  m.auth.mockResolvedValue(null); await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  expect(m.context).not.toHaveBeenCalled(); expect(m.report).not.toHaveBeenCalled();
});
it("workers without finance capability cannot resolve or query records", async () => {
  m.can.mockReturnValue(false); await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  expect(m.can).toHaveBeenCalledWith(expect.any(Object), "view_finance"); expect(m.context).not.toHaveBeenCalled(); expect(m.report).not.toHaveBeenCalled();
});
it("ambiguous organization does not choose the first organization", async () => {
  m.context.mockResolvedValue({ status: "unconfigured", reason: "Choose organization" });
  await Page({ searchParams: Promise.resolve({}) }); expect(m.report).not.toHaveBeenCalled();
});
it("read failure keeps the selected month on an explicit retry", async () => {
  m.report.mockRejectedValue(new Error("private database detail"));
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ period: "2026-10" }) }));
  expect(html).toContain("Try again"); expect(html).toContain('href="/finance/reports/general-ledger?period=2026-10"');
  expect(html).not.toContain("private database detail"); expect(html).not.toContain("$0");
});
it("keeps unavailable feedback within the workspace landmark and offers Finance setup", async () => {
  const { render, screen, cleanup } = await import("@testing-library/react");
  try {
    render(<main aria-label="Workspace">{await Page({ searchParams: Promise.resolve({}) })}</main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Open Finance" }).getAttribute("href")).toBe("/finance");
    expect(screen.getByText("No recorded entries")).toBeTruthy();
  } finally { cleanup(); }
});
it("labels available monthly records as movements rather than a verified position", async () => {
  const { computeTrialBalance } = await import("@/lib/finance/ledger");
  m.report.mockResolvedValue({ availability: "available", periodKey: "2026-10", currency: "EUR",
    trialBalance: computeTrialBalance([
      { accountId: "expense", code: "5000", name: "Cost", type: "expense" },
      { accountId: "ap", code: "2000", name: "Payables", type: "liability" },
    ], [{ accountId: "expense", debit: 200, credit: 0 }, { accountId: "ap", debit: 0, credit: 200 }]) });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ period: "2026-10" }) }));
  expect(html).toContain("Recorded movements"); expect(html).toContain("€200.00");
  expect(html).toContain("not a verified bank balance or as-of position");
  expect(html).toMatch(/<details[^>]*>.*Account details.*<table/s);
  expect(html).not.toContain("Financial position"); expect(html).not.toContain("Books balance");
});
