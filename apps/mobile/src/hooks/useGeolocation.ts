/**
 * Thin wrapper around expo-location for the Nearby surface — requests
 * foreground permission once, then returns the device's current position
 * (or an error). Wrapped in a hook so React components don't need to
 * branch on permission state directly.
 *
 * Tests mock this hook rather than the native module — see
 * src/features/nearby/nearby.store.test.ts.
 */
import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";

/**
 * What a person sees when the device can't produce a fix. expo-location's own
 * error text (e.g. "FunctionCallException ... kCLErrorDomain error 0.") is
 * meant for developers, so it goes to the console and never to the screen.
 */
export const LOCATION_UNAVAILABLE_MESSAGE =
  "We couldn't find your location. Check that location is on, then try again.";

export interface GeoLocationState {
  /** Captured WGS84 position, null until we have one. */
  latitude: number | null;
  longitude: number | null;
  /** Reactive permission state — drives a "Grant location" CTA when "denied". */
  permission: "granted" | "denied" | "unknown";
  isFetching: boolean;
  /** Plain-language failure for display; never the native error text. */
  error: string | null;
  /** Trigger a permission request + a single fix; safe to call repeatedly. */
  refresh: () => Promise<void>;
}

export type OneFixResult =
  | { status: "fix"; latitude: number; longitude: number; accuracyMeters: number }
  | { status: "denied" }
  | { status: "unavailable"; message: string };

/**
 * One foreground position fix, asking for permission only now (BI-C318C227
 * §2.2). Called from a person's tap, never on mount; no watch and no
 * background location.
 */
export async function takeOneFix(): Promise<OneFixResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return { status: "denied" };
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      status: "fix",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
    };
  } catch (err) {
    console.warn("[takeOneFix] location unavailable", err);
    return { status: "unavailable", message: LOCATION_UNAVAILABLE_MESSAGE };
  }
}

export function useGeolocation(options: { auto?: boolean } = {}): GeoLocationState {
  const auto = options.auto ?? true;
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [permission, setPermission] = useState<GeoLocationState["permission"]>(
    "unknown",
  );
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setIsFetching(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermission("denied");
        setIsFetching(false);
        return;
      }
      setPermission("granted");
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLatitude(position.coords.latitude);
      setLongitude(position.coords.longitude);
    } catch (err) {
      console.warn("[useGeolocation] location unavailable", err);
      setError(LOCATION_UNAVAILABLE_MESSAGE);
    } finally {
      setIsFetching(false);
    }
  }, []);

  // Try once on first mount. The user can always tap a Refresh action to
  // re-request if they revoked the permission in iOS Settings between
  // launches.
  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return {
    latitude,
    longitude,
    permission,
    isFetching,
    error,
    refresh,
  };
}
