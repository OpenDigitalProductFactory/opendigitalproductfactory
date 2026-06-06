import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { EpicCard } from "./EpicCard";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("EpicCard", () => {
  const fakeEpic = {
    id: "epic-1",
    title: "Onboarding Flow",
    status: "open",
    description: "Build onboarding",
    items: [{ id: "item-1" }, { id: "item-2" }],
    portfolios: [],
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders epic title", async () => {
    const { getByText } = await render(<EpicCard epic={fakeEpic} />);
    expect(getByText("Onboarding Flow")).toBeTruthy();
  });

  it("renders item count", async () => {
    const { getByText } = await render(<EpicCard epic={fakeEpic} />);
    expect(getByText("2 items")).toBeTruthy();
  });

  it("renders singular item count for 1 item", async () => {
    const epic = { ...fakeEpic, items: [{ id: "item-1" }] };
    const { getByText } = await render(<EpicCard epic={epic} />);
    expect(getByText("1 item")).toBeTruthy();
  });

  it("navigates to epic detail on press", async () => {
    const { getByLabelText } = await render(<EpicCard epic={fakeEpic} />);
    await fireEvent.press(getByLabelText("Epic: Onboarding Flow"));
    expect(mockPush).toHaveBeenCalledWith("/ops/epic-1");
  });
});
