import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("view=timeoff"),
}));

import { EmployeeTabNav } from "./EmployeeTabNav";

describe("EmployeeTabNav", () => {
  it("wraps the expanded people navigation instead of overflowing narrow screens", () => {
    const html = renderToStaticMarkup(<EmployeeTabNav />);
    expect(html).toContain("flex-wrap");
    expect(html).toContain("Time off");
  });
});
