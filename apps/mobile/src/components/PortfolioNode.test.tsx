import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { PortfolioNode } from "./PortfolioNode";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

describe("PortfolioNode", () => {
  const fakePortfolio = {
    id: "port-1",
    slug: "platform",
    name: "Platform Portfolio",
    description: "Main platform portfolio",
    rootNodeId: null,
    budgetKUsd: 500,
    products: [{ id: "prod-1" }, { id: "prod-2" }],
    epicPortfolios: [],
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders portfolio name", () => {
    const { getByText } = render(
      <PortfolioNode portfolio={fakePortfolio} />,
    );
    expect(getByText("Platform Portfolio")).toBeTruthy();
  });

  it("renders product count", () => {
    const { getByText } = render(
      <PortfolioNode portfolio={fakePortfolio} />,
    );
    expect(getByText("2 products")).toBeTruthy();
  });

  it("renders singular product count for 1 product", () => {
    const portfolio = { ...fakePortfolio, products: [{ id: "prod-1" }] };
    const { getByText } = render(
      <PortfolioNode portfolio={portfolio} />,
    );
    expect(getByText("1 product")).toBeTruthy();
  });

  it("shows description when expanded", () => {
    const { getByLabelText, getByText, queryByText } = render(
      <PortfolioNode portfolio={fakePortfolio} />,
    );
    // Description should not be visible initially
    expect(queryByText("Main platform portfolio")).toBeNull();

    // Tap to expand
    fireEvent.press(getByLabelText("Portfolio: Platform Portfolio"));
    expect(getByText("Main platform portfolio")).toBeTruthy();
  });

  it("navigates to detail on long press", () => {
    const { getByLabelText } = render(
      <PortfolioNode portfolio={fakePortfolio} />,
    );
    fireEvent(getByLabelText("Portfolio: Platform Portfolio"), "longPress");
    expect(mockPush).toHaveBeenCalledWith("/portfolio/port-1");
  });

  it("navigates to detail via arrow button", () => {
    const { getByLabelText } = render(
      <PortfolioNode portfolio={fakePortfolio} />,
    );
    fireEvent.press(
      getByLabelText("View Platform Portfolio details"),
    );
    expect(mockPush).toHaveBeenCalledWith("/portfolio/port-1");
  });
});
