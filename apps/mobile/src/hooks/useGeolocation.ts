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

export interface GeoLocationState {
  /** Captured WGS84 position, null until we have one. */
  latitude: number | null;
  longitude: number | null;
  /** Reactive permission state — drives a "Grant location" CTA when "denied". */
  permission: "granted" | "denied" | "unknown";
  isFetching: boolean;
  error: string | null;
  /** Trigger a permission request + a single fix; safe to call repeatedly. */
  refresh: () => Promise<void>;
}

export function useGeolocation(): GeoLocationState {
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
      setError(err instanceof Error ? err.message : "Location unavailable");
    } finally {
      setIsFetching(false);
    }
  }, []);

  // Try once on first mount. The user can always tap a Refresh action to
  // re-request if they revoked the permission in iOS Settings between
  // launches.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    latitude,
    longitude,
    permission,
    isFetching,
    error,
    refresh,
  };
}
