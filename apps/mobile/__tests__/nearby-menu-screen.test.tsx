// Lives outside app/ because every file under app/ becomes an expo-router route.
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import NearbyMenuScreen from "@/app/(tabs)/nearby/[slug]";
import { MENU_UNAVAILABLE_MESSAGE } from "@/src/features/visitor/visitor.store";

const mockFetchMenu = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ slug: "corner-table" }),
}));

// The real store is loaded for its message constant; keep the API client (and
// its native storage) out so expo's runtime globals are never installed.
jest.mock("@/src/lib/apiClient", () => ({ api: {} }));

jest.mock("@/src/features/visitor/visitor.store", () => ({
  ...jest.requireActual("@/src/features/visitor/visitor.store"),
  useVisitorStore: () => ({
    menu: null,
    isLoadingMenu: false,
    menuError: jest.requireActual("@/src/features/visitor/visitor.store")
      .MENU_UNAVAILABLE_MESSAGE,
    fetchMenu: mockFetchMenu,
  }),
}));

describe("NearbyMenuScreen load failure", () => {
  beforeEach(() => mockFetchMenu.mockReset());

  it("shows the plain-language message, not network error text", async () => {
    const { getByTestId, queryByText } = await render(<NearbyMenuScreen />);
    expect(getByTestId("menu-error")).toHaveTextContent(MENU_UNAVAILABLE_MESSAGE);
    expect(queryByText(/fetch failed|Could not connect|404/)).toBeNull();
  });

  it("offers a retry that loads the same menu again", async () => {
    const { getByTestId } = await render(<NearbyMenuScreen />);
    mockFetchMenu.mockClear(); // ignore the load the screen ran on mount
    await fireEvent.press(getByTestId("menu-retry"));
    expect(mockFetchMenu).toHaveBeenCalledWith("corner-table");
  });
});
