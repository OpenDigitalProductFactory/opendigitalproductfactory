import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { measureUxBudget } from "@/lib/ux-budget/measure";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ea/workrooms" }));
vi.mock("@/lib/ea/workroom-architecture", () => ({
  loadWorkroomArchitecture: vi.fn(async () => [
    { role: "foundational", label: "Foundational", definitions: [] },
    { role: "manufactureAndDeliver", label: "Manufacture and Deliver", definitions: [] },
    { role: "forEmployees", label: "For Employees", definitions: [] },
    { role: "productsAndServicesSold", label: "Products and Services Sold", definitions: [] },
  ]),
}));

import WorkroomArchitecturePage from "./page";

describe("WorkroomArchitecturePage", () => {
  it("keeps the empty definition home within the high-school reading cap", async () => {
    const html = renderToStaticMarkup(await WorkroomArchitecturePage());

    expect(measureUxBudget(html).readingGradeLevel).toBeLessThanOrEqual(9);
  });
});
