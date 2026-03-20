import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { CustomerCard } from "./CustomerCard";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("CustomerCard", () => {
  const fakeCustomer = {
    id: "cust-1",
    accountId: "ACC-001",
    name: "Acme Corp",
    status: "prospect",
    contacts: [
      { id: "contact-1", name: "John Doe", email: "john@acme.com" },
      { id: "contact-2", name: "Jane Doe", email: "jane@acme.com" },
    ],
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders customer name", () => {
    const { getByText } = render(<CustomerCard customer={fakeCustomer} />);
    expect(getByText("Acme Corp")).toBeTruthy();
  });

  it("renders contact count", () => {
    const { getByText } = render(<CustomerCard customer={fakeCustomer} />);
    expect(getByText("2 contacts")).toBeTruthy();
  });

  it("renders singular contact count for 1 contact", () => {
    const customer = {
      ...fakeCustomer,
      contacts: [{ id: "contact-1", name: "John" }],
    };
    const { getByText } = render(<CustomerCard customer={customer} />);
    expect(getByText("1 contact")).toBeTruthy();
  });

  it("renders status", () => {
    const { getByText } = render(<CustomerCard customer={fakeCustomer} />);
    expect(getByText("prospect")).toBeTruthy();
  });

  it("renders account ID", () => {
    const { getByText } = render(<CustomerCard customer={fakeCustomer} />);
    expect(getByText("ACC-001")).toBeTruthy();
  });

  it("navigates to customer detail on press", () => {
    const { getByLabelText } = render(
      <CustomerCard customer={fakeCustomer} />,
    );
    fireEvent.press(getByLabelText("Customer: Acme Corp"));
    expect(mockPush).toHaveBeenCalledWith("/customers/cust-1");
  });
});
