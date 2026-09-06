// Offline budget and copy checks for the adoption waiting list (BI-899D7F00).
//
// The page is an async server component; awaiting it yields the JSX tree, and
// renderToStaticMarkup gives the served DOM minus the shell chrome. The UX
// budget is measured on that string with routeStatus "net-new" so every
// absolute for the detail shell is blocking, not advisory — the served-app
// sweep in CI re-measures the whole page, chrome included, and is the number
// the UX-Fit manifest carries.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { auditUxBudget } from "@/lib/ux-budget";

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: (...args: unknown[]) => findFirst(...args) },
    adoptableAnimal: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

import AdoptionWaitingListPage from "./page";

const day = 24 * 60 * 60 * 1000;

function animal(name: string, daysAgo: number | null, overrides: Record<string, unknown> = {}) {
  return {
    id: name.toLowerCase(), name, species: "dog", breed: null, status: "available",
    publishedAt: daysAgo === null ? null : new Date(Date.now() - daysAgo * day),
    ...overrides,
  };
}

async function render(): Promise<string> {
  const element = await AdoptionWaitingListPage();
  return renderToStaticMarkup(element);
}

function expectWithinBudget(html: string) {
  const report = auditUxBudget(html, "detail", { routeStatus: "net-new", audience: "owner" });
  const failing = report.findings.filter((f) => !f.ok);
  expect(failing.map((f) => `${f.check}: ${f.detail}`)).toEqual([]);
}

describe("AdoptionWaitingListPage", () => {
  afterEach(() => {
    findFirst.mockReset();
    findMany.mockReset();
  });

  it("lists every listed animal longest wait first, with whole days, and stays within the detail-shell budget", async () => {
    findFirst.mockResolvedValue({ id: "sf" });
    findMany.mockResolvedValue([
      animal("Biscuit", 14, { species: "cat" }),
      animal("Ada", 94, { breed: "Collie mix" }),
      animal("Coco", -7, { species: "rabbit" }),
      animal("Dusty", null),
      animal("Gone", 200, { status: "adopted" }),
    ]);

    const html = await render();

    expect(html.indexOf("Ada")).toBeLessThan(html.indexOf("Biscuit"));
    expect(html.indexOf("Biscuit")).toBeLessThan(html.indexOf("Coco"));
    expect(html.indexOf("Coco")).toBeLessThan(html.indexOf("Dusty"));
    expect(html).not.toContain("Gone");
    expect(html).toContain(">94<");
    expect(html).toContain("Date is in the future");
    expect(html).toContain("No date");
    expect(html).toContain("Rabbit");
    expect(html).toContain("4 listed");
    expect(html).not.toContain("longest-waiting of");
    expectWithinBudget(html);
  });

  it("keeps a hundred rows on one page: twenty-five open, the rest behind one disclosure, and says the cap bit", async () => {
    findFirst.mockResolvedValue({ id: "sf" });
    findMany.mockResolvedValue(Array.from({ length: 103 }, (_, i) => animal(`Animal${String(i).padStart(3, "0")}`, 400 - i)));

    const html = await render();

    expect(html).toContain("Show the other 75 animals");
    expect(html).toContain("Showing the 100 longest-waiting of 103 listed animals.");
    expect(html).toContain("Animal000");
    expect(html).toContain("Animal099");
    expect(html).not.toContain("Animal100");
    expectWithinBudget(html);
  });

  it("says no animals are listed rather than showing an empty table", async () => {
    findFirst.mockResolvedValue({ id: "sf" });
    findMany.mockResolvedValue([animal("Held", 30, { status: "hold" })]);

    const html = await render();

    expect(html).toContain("No animals are listed right now.");
    expect(html).not.toContain("<table");
    expectWithinBudget(html);
  });

  it("points at setup when there is no storefront, and never queries animals", async () => {
    findFirst.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain("There is no storefront yet.");
    expect(html).toContain('href="/storefront/setup"');
    expect(findMany).not.toHaveBeenCalled();
    expectWithinBudget(html);
  });
});
