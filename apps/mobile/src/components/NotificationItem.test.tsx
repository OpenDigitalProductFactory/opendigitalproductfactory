import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { NotificationItem } from "./NotificationItem";

describe("NotificationItem", () => {
  const unreadNotification = {
    id: "notif-1",
    userId: "user-1",
    type: "approval_request",
    title: "New approval needed",
    body: "Agent wants to create a backlog item",
    deepLink: "/more/approvals",
    read: false,
    createdAt: new Date().toISOString(),
  } as any;

  const readNotification = {
    ...unreadNotification,
    id: "notif-2",
    title: "Compliance alert resolved",
    read: true,
  } as any;

  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders notification title", () => {
    const { getByText } = render(
      <NotificationItem
        notification={unreadNotification}
        onPress={mockOnPress}
      />,
    );
    expect(getByText("New approval needed")).toBeTruthy();
  });

  it("renders notification body", () => {
    const { getByText } = render(
      <NotificationItem
        notification={unreadNotification}
        onPress={mockOnPress}
      />,
    );
    expect(
      getByText("Agent wants to create a backlog item"),
    ).toBeTruthy();
  });

  it("calls onPress with notification when tapped", () => {
    const { getByText } = render(
      <NotificationItem
        notification={unreadNotification}
        onPress={mockOnPress}
      />,
    );
    fireEvent.press(getByText("New approval needed"));
    expect(mockOnPress).toHaveBeenCalledWith(unreadNotification);
  });

  it("includes unread in accessibility label for unread items", () => {
    const { getByLabelText } = render(
      <NotificationItem
        notification={unreadNotification}
        onPress={mockOnPress}
      />,
    );
    expect(
      getByLabelText("New approval needed, unread"),
    ).toBeTruthy();
  });

  it("does not include unread in accessibility label for read items", () => {
    const { getByLabelText } = render(
      <NotificationItem
        notification={readNotification}
        onPress={mockOnPress}
      />,
    );
    expect(
      getByLabelText("Compliance alert resolved"),
    ).toBeTruthy();
  });
});
