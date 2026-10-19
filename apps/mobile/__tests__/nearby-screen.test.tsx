// Lives outside app/ because every file under app/ becomes an expo-router route.
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import NearbyScreen from "@/app/(tabs)/nearby/index";
import { LOCATION_UNAVAILABLE_MESSAGE } from "@/src/hooks/useGeolocation";
import { NEARBY_UNAVAILABLE_MESSAGE } from "@/src/features/visitor/visitor.store";

const mockRefresh = jest.fn();
const mockFetchNearby = jest.fn();
let mockGeo: Record<string, unknown>;
let mockVisitor: Record<string, unknown>;

jest.mock("@/src/hooks/useGeolocation", () => ({
  ...jest.requireActual("@/src/hooks/useGeolocation"),
  useGeolocation: () => mockGeo,
}));

// The hook module is loaded for its message constant; stub the native module
// so expo's runtime globals are never installed. They resolve lazily and
// throw "require ... outside of the scope of the test code" after teardown.
jest.mock("expo-location", () => ({}));

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/src/features/auth/auth.store", () => ({
  useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: false }),
}));

// Same reason as expo-location above: the real store is loaded for its
// message constants, so keep the API client (and its native storage) out.
jest.mock("@/src/lib/apiClient", () => ({ api: {} }));

jest.mock("@/src/features/visitor/visitor.store", () => ({
  ...jest.requireActual("@/src/features/visitor/visitor.store"),
  orderForDisplay: (b: unknown[]) => b,
  useVisitorStore: () => mockVisitor,
}));

beforeEach(() => {
  mockRefresh.mockReset();
  mockFetchNearby.mockReset();
  mockVisitor = {
    businesses: [],
    isLoadingNearby: false,
    nearbyError: null,
    fetchNearby: mockFetchNearby,
  };
});

describe("NearbyScreen location failure", () => {
  beforeEach(() => {
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

describe("NearbyScreen lookup failure", () => {
  beforeEach(() => {
    mockGeo = {
      latitude: 51.5,
      longitude: -0.12,
      permission: "granted",
      isFetching: false,
      error: null,
      refresh: mockRefresh,
    };
    mockVisitor.nearbyError = NEARBY_UNAVAILABLE_MESSAGE;
  });

  it("shows the plain-language message, not network error text", async () => {
    const { getByTestId, queryByText } = await render(<NearbyScreen />);
    expect(getByTestId("nearby-error")).toHaveTextContent(NEARBY_UNAVAILABLE_MESSAGE);
    expect(queryByText(/fetch failed|Could not connect/)).toBeNull();
    // A failed lookup is not evidence that nothing is nearby.
    expect(queryByText("No businesses found near you yet.")).toBeNull();
  });

  it("offers a retry that repeats the lookup for the same position", async () => {
    const { getByTestId } = await render(<NearbyScreen />);
    mockFetchNearby.mockClear(); // ignore the lookup the screen ran on mount
    await fireEvent.press(getByTestId("nearby-retry"));
    expect(mockFetchNearby).toHaveBeenCalledWith({ latitude: 51.5, longitude: -0.12 });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
