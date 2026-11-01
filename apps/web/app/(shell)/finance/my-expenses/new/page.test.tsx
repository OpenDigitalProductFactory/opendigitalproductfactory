import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/shared/guards", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/i18n/t.server", async () => {
  const { translate } = await import("@dpf/i18n");
  return { getT: async () => (key: never) => translate("en-US", "shell", key) };
});
vi.mock("@dpf/db", () => ({ prisma: { employeeProfile: { findFirst: vi.fn() } } }));
vi.mock("@/lib/actions/currency", () => ({ getOrgSettings: vi.fn().mockResolvedValue({ baseCurrency: "USD" }) }));
vi.mock("@/components/finance/CreateExpenseForm", () => ({ CreateExpenseForm: () => <form aria-label="Expense entry" /> }));

import { prisma } from "@dpf/db";
import { requireUser } from "@/lib/actions/shared/guards";
import NewExpensePage from "./page";

describe("own expense entry prerequisites", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(prisma.employeeProfile.findFirst).mockReset();
    vi.mocked(requireUser).mockResolvedValue({ id: "owner" } as Awaited<ReturnType<typeof requireUser>>);
  });
  it("explains a missing claimant profile before offering a form", async () => {
    vi.mocked(prisma.employeeProfile.findFirst).mockResolvedValue(null);
    const html = renderToStaticMarkup(await NewExpensePage());
    expect(html).toContain("employee profile");
    expect(html).not.toContain('aria-label="Expense entry"');
    expect(prisma.employeeProfile.findFirst).toHaveBeenCalledWith({ where: { userId: "owner" }, select: { id: true } });
  });
  it("offers the existing form to an identified claimant with required information", async () => {
    vi.mocked(prisma.employeeProfile.findFirst).mockResolvedValue({ id: "employee" } as never);
    const html = renderToStaticMarkup(await NewExpensePage());
    expect(html).toContain('aria-label="Expense entry"');
    expect(html).toContain("Receipt links are optional");
  });
  it("keeps the visible entry header within its existing 14-word budget", async () => {
    vi.mocked(prisma.employeeProfile.findFirst).mockResolvedValue({ id: "employee" } as never);
    const html = renderToStaticMarkup(await NewExpensePage());
    // Closed native details expose only their summary. This is a source-render
    // header guard, not a substitute for the actual served route sweep.
    const visible = html.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/g,
      (_details, inner: string) => inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "")
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const words = visible.split(" ").filter(word => /[\p{L}\p{N}]/u.test(word));
    expect(words.length).toBeLessThanOrEqual(14);
    expect(html).toContain("positive amount");
    expect(html).toContain("Submit for Approval");
  });
  it("does not query a claimant profile for an unauthenticated visitor", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized"));
    await expect(NewExpensePage()).rejects.toThrow("Unauthorized");
    expect(prisma.employeeProfile.findFirst).not.toHaveBeenCalled();
  });
});
