import { renderHook, waitFor } from "@testing-library/react-native";
import * as Location from "expo-location";
import { LOCATION_UNAVAILABLE_MESSAGE, useGeolocation } from "./useGeolocation";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;

// The text expo-location throws on iOS when Core Location has no fix.
const NATIVE_FAILURE =
  "FunctionCallException: Calling the 'getCurrentPositionAsync' function has failed\n" +
  "→ Caused by: LocationUnavailable: Cannot obtain current location: " +
  "The operation couldn't be completed. (kCLErrorDomain error 0.)";

describe("useGeolocation", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    requestPermission.mockResolvedValue({ status: "granted" });
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it("returns the position when a fix is available", async () => {
    getPosition.mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.12 } });
    const { result } = await renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.latitude).toBe(51.5));
    expect(result.current.longitude).toBe(-0.12);
    expect(result.current.error).toBeNull();
  });

  it("maps a native location failure to a plain-language message", async () => {
    getPosition.mockRejectedValue(new Error(NATIVE_FAILURE));
    const { result } = await renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(LOCATION_UNAVAILABLE_MESSAGE);
    expect(result.current.error).not.toMatch(/Exception|kCLErrorDomain|getCurrentPositionAsync/);
    expect(result.current.isFetching).toBe(false);
  });

  it("maps a non-Error rejection to the same message", async () => {
    getPosition.mockRejectedValue("boom");
    const { result } = await renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.error).toBe(LOCATION_UNAVAILABLE_MESSAGE));
  });

  it("clears the error once a retry gets a fix", async () => {
    getPosition.mockRejectedValueOnce(new Error(NATIVE_FAILURE));
    const { result } = await renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.error).toBe(LOCATION_UNAVAILABLE_MESSAGE));

    getPosition.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    await result.current.refresh();
    await waitFor(() => expect(result.current.latitude).toBe(1));
    expect(result.current.error).toBeNull();
  });
});
