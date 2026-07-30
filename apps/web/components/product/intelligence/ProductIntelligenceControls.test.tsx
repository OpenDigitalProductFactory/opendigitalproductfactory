// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propose: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("@/lib/actions/product-intelligence", () => ({
  proposeProductResearchAction: mocks.propose,
  createProductIntelligenceWatchAction: mocks.watch,
}));

import { ProductIntelligenceControls } from "./ProductIntelligenceControls";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.propose.mockResolvedValue({
    ok: true,
    message: "Research proposal created for review.",
  });
  mocks.watch.mockResolvedValue({
    ok: true,
    message: "Recurring scan scheduled.",
  });
});

function fillQuestion() {
  fireEvent.change(screen.getByLabelText("Topic"), {
    target: { value: "Customer choice" },
  });
  fireEvent.change(screen.getByLabelText("Research question"), {
    target: { value: "What changed in customer choice?" },
  });
}

describe("ProductIntelligenceControls", () => {
  it("previews scope and approval consequences before proposing research", async () => {
    render(
      <ProductIntelligenceControls
        productId="product-1"
        productName="Hair appointments"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Propose research" }));
    fillQuestion();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Hair appointments")).toBeTruthy();
    expect(screen.getByText("One pending research proposal")).toBeTruthy();
    expect(screen.getByText(/research runs after a person approves/i)).toBeTruthy();
    expect(mocks.propose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
    await waitFor(() =>
      expect(mocks.propose).toHaveBeenCalledWith({
        productId: "product-1",
        topic: "Customer choice",
        query: "What changed in customer choice?",
      }),
    );
  });

  it("cancels a preview without writing and discloses proposal-only cadence", () => {
    render(
      <ProductIntelligenceControls
        productId="product-1"
        productName="Hair appointments"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Schedule a recurring scan" }),
    );
    fillQuestion();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Weekly · Monday at 09:00 UTC")).toBeTruthy();
    expect(screen.getByText(/does not search the web/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.watch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Propose research" }),
    ).toBeTruthy();
  });
});
