// Lives outside app/ because every file under app/ becomes an expo-router route.
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import NearbyScreen from "@/app/(tabs)/nearby/index";
import { LOCATION_UNAVAILABLE_MESSAGE } from "@/src/hooks/useGeolocation";

const mockRefresh = jest.fn();
let mockGeo: Record<string, unknown>;

jest.mock("@/src/hooks/useGeolocation", () => ({
  ...jest.requireActual("@/src/hooks/useGeolocation"),
  useGeolocation: () => mockGeo,
}));

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/src/features/auth/auth.store", () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: false }),
}));

jest.mock("@/src/features/visitor/visitor.store", () => ({
  orderForDisplay: (b: unknown[]) => b,
  useVisitorStore: () => ({
    businesses: [],
    isLoadingNearby: false,
    nearbyError: null,
    fetchNearby: jest.fn(),
  }),
}));

describe("NearbyScreen location failure", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockGeo = {
      latitude: null,
      longitude: null,
      permission: "granted",
      isFetching: false,
      error: LOCATION_UNAVAILABLE_MESSAGE,
      refresh: mockRefresh,
    };
  });

  it("shows the plain-language message, not native exception text", async () => {
    const { getByTestId, queryByText } = await render(<NearbyScreen />);
    expect(getByTestId("nearby-error")).toHaveTextContent(LOCATION_UNAVAILABLE_MESSAGE);
    expect(queryByText(/Exception|kCLErrorDomain/)).toBeNull();
    // No "nothing near you" claim when we never learned where "here" is.
    expect(queryByText("No businesses found near you yet.")).toBeNull();
  });

  it("offers a retry that asks for the location again", async () => {
    const { getByTestId } = await render(<NearbyScreen />);
    await fireEvent.press(getByTestId("nearby-retry"));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
