// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

import { ProductContextActionPreview } from "./ProductContextActionPreview";

afterEach(cleanup);

describe("ProductContextActionPreview", () => {
  it("previews scope and consequences before navigation and supports cancellation", () => {
    render(
      <ProductContextActionPreview
        scopeLabel="product: product-1"
        sourceKinds={["backlog-item", "research-proposal"]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview a demand review" }),
    );
    expect(screen.getByText("product: product-1")).toBeTruthy();
    expect(screen.getByText("backlog-item, research-proposal")).toBeTruthy();
    expect(screen.getByText(/None from this page/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Continue to Delivery" })
        .getAttribute("href"),
    ).toBe("/delivery?view=flow");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("heading", {
        name: "Preview: review product demand",
      }),
    ).toBeNull();
  });
});
