import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { BacklogItemCard } from "./BacklogItemCard";

describe("BacklogItemCard", () => {
  const fakeItem = {
    id: "item-1",
    title: "Design wireframes",
    status: "open",
    type: "product",
    priority: 100,
    body: null,
    epicId: "epic-1",
    epic: { id: "epic-1", title: "Onboarding Flow" },
    digitalProduct: null,
    taxonomyNode: null,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
  } as any;

  it("renders item title", () => {
    const { getByText } = render(<BacklogItemCard item={fakeItem} />);
    expect(getByText("Design wireframes")).toBeTruthy();
  });

  it("renders priority", () => {
    const { getByText } = render(<BacklogItemCard item={fakeItem} />);
    expect(getByText("P100")).toBeTruthy();
  });

  it("renders epic name", () => {
    const { getByText } = render(<BacklogItemCard item={fakeItem} />);
    expect(getByText("Onboarding Flow")).toBeTruthy();
  });

  it("renders 'No epic' when epic is null", () => {
    const item = { ...fakeItem, epic: null };
    const { getByText } = render(<BacklogItemCard item={item} />);
    expect(getByText("No epic")).toBeTruthy();
  });

  it("calls onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <BacklogItemCard item={fakeItem} onPress={onPress} />,
    );
    fireEvent.press(getByLabelText("Backlog item: Design wireframes"));
    expect(onPress).toHaveBeenCalledWith(fakeItem);
  });

  it("does not crash when no onPress provided", () => {
    const { getByLabelText } = render(<BacklogItemCard item={fakeItem} />);
    // Should not throw
    fireEvent.press(getByLabelText("Backlog item: Design wireframes"));
  });
});
