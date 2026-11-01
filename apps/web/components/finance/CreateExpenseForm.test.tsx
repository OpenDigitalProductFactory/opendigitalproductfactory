// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { create, submit, push } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "fixture-claim" })), submit: vi.fn(), push: vi.fn(),
}));
vi.mock("@/lib/actions/expenses", () => ({ createExpenseClaim: create, submitExpenseClaim: submit }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { CreateExpenseForm } from "./CreateExpenseForm";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each(["Save as Draft", "Submit for Approval"])("explains missing fields before %s and preserves corrections", async action => {
  render(<CreateExpenseForm currencySymbol="$" />);
  fireEvent.click(screen.getByRole("button", { name: action }));
  const message = await screen.findByText(/Enter a title/);
  expect(message.textContent).toContain("Item 1: enter a description");
  expect(message.textContent).toContain("Item 1: enter an amount greater than zero");
  expect(message.textContent).not.toMatch(/too_small|\"path\"|\"origin\"/);
  expect(create).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText(/Client visit expenses/), { target: { value: "Test expense" } });
  fireEvent.change(screen.getByPlaceholderText("Brief description of expense"), { target: { value: "Simulated fixture" } });
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12.34" } });
  fireEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/finance/my-expenses"));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Test expense", items: [expect.objectContaining({ amount: 12.34, description: "Simulated fixture" })] }));
  expect(submit).toHaveBeenCalledTimes(action === "Submit for Approval" ? 1 : 0);
});

