/**
 * Customer map on the phone (BI-3DAE2169): customer sites and service areas on
 * the install's own street map, with Follow me, Recenter, a compass and a
 * legend. A site list sits under the map, and stands alone with a plain reason
 * whenever the map cannot be drawn — never a blank map.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  Camera,
  type CameraRef,
  Map,
  Marker,
  type StyleSpecification,
  TransformRequestManager,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import type { CustomerMapSiteSummary, CustomerSitesMapResponse } from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { getServerUrl } from "@/src/lib/serverConfig";
import { useTheme } from "@/src/lib/theme";
import { SecureStorage } from "@/src/repositories/SecureStorage";
import {
  installOriginPattern,
  MAP_LEGEND,
  mapScreenState,
  type MapScreenInput,
  phoneMapStyle,
  sceneBounds,
  siteMarkers,
} from "@/src/features/map/customerMap";

const AUTH_HEADER_ID = "dpf-install-bearer";
const FIT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
// The legend's "you" swatch matches MapLibre Native's own location puck, which
// is drawn natively and does not take the app theme.
const NATIVE_PUCK_BLUE = "#1d8cf8";

export default function CustomerMapScreen(): React.JSX.Element {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const camera = useRef<CameraRef>(null);
  const [input, setInput] = useState<MapScreenInput>({ status: "loading" });
  const [authReady, setAuthReady] = useState(false);
  const [following, setFollowing] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const load = useCallback(async () => {
    setInput({ status: "loading" });
    try {
      // The API call refreshes an expired token first, so the token read after
      // it is the one the tile requests should carry.
      const response = await api.map.customerSites();
      const token = await SecureStorage.getAccessToken();
      if (token) {
        TransformRequestManager.addHeader({
          id: AUTH_HEADER_ID,
          match: installOriginPattern(getServerUrl()),
          name: "Authorization",
          value: `Bearer ${token}`,
        });
      }
      setAuthReady(true);
      setInput({ status: "loaded", response, mapFailed: false });
    } catch (error) {
      setInput({ status: "error", message: error instanceof Error ? error.message : "unknown error" });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => TransformRequestManager.removeHeader(AUTH_HEADER_ID);
  }, [load]);

  const state = mapScreenState(input);
  const response: CustomerSitesMapResponse | null = input.status === "loaded" ? input.response : null;
  const markers = useMemo(() => (response ? siteMarkers(response) : []), [response]);
  const bounds = response ? sceneBounds(response) : null;
  const mapStyle = useMemo(
    () =>
      response && state.kind === "loaded" && state.map !== "none"
        ? (phoneMapStyle({ response, colors, origin: getServerUrl(), street: state.map === "street" }) as unknown as StyleSpecification)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the data, theme or map kind change
    [response, colors, state.kind === "loaded" ? state.map : null],
  );

  const openAccount = useCallback(
    (site: CustomerMapSiteSummary) => router.push(`/customers/${encodeURIComponent(site.accountId)}`),
    [router],
  );

  const toggleFollow = useCallback(async () => {
    if (following) {
      setFollowing(false);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocationNote("Turn on location for this app to use Follow me.");
      return;
    }
    setLocationNote(null);
    setFollowing(true);
  }, [following]);

  const recenter = useCallback(() => {
    setFollowing(false);
    if (bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 600 });
  }, [bounds]);

  const header = <Stack.Screen options={{ title: "Customer map" }} />;

  if (state.kind === "loading") {
    return (
      <View style={styles.centre}>
        {header}
        <ActivityIndicator color={colors.primary} testID="customer-map-loading" />
      </View>
    );
  }

  const sites = response?.sites ?? [];
  const showMap = mapStyle !== null && authReady;

  return (
    <View style={styles.screen}>
      {header}
      {showMap ? (
        <View style={styles.mapFrame} testID="customer-map">
          <Map
            style={StyleSheet.absoluteFill}
            mapStyle={mapStyle}
            compass
            attribution
            logo={false}
            onDidFailLoadingMap={() => input.status === "loaded" && setInput({ ...input, mapFailed: true })}
          >
            <Camera
              ref={camera}
              initialViewState={
                bounds
                  ? { bounds, padding: FIT_PADDING }
                  : response?.model
                    ? {
                        center: [response.model.viewport.longitude, response.model.viewport.latitude],
                        zoom: response.model.viewport.zoom,
                      }
                    : undefined
              }
              trackUserLocation={following ? "default" : undefined}
              onTrackUserLocationChange={(event) => {
                if (event.nativeEvent.trackUserLocation === null) setFollowing(false);
              }}
            />
            {following ? <UserLocation /> : null}
            {markers.map((site) => (
              <Marker
                key={site.siteId}
                id={`site-${site.siteId}`}
                lngLat={[site.longitude, site.latitude]}
                onPress={() => openAccount(site)}
              >
                <View
                  style={styles.pin}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${site.accountName}, ${site.siteName}. Open the account.`}
                  testID={`customer-map-site-${site.siteId}`}
                >
                  <Text style={styles.pinLetter}>{site.letter}</Text>
                </View>
              </Marker>
            ))}
          </Map>
          <View style={styles.controls}>
            <Pressable
              style={[styles.control, following && styles.controlOn]}
              onPress={() => void toggleFollow()}
              accessibilityRole="switch"
              accessibilityState={{ checked: following }}
              testID="customer-map-follow"
            >
              <Text style={[styles.controlText, following && styles.controlTextOn]}>Follow me</Text>
            </Pressable>
            <Pressable style={styles.control} onPress={recenter} accessibilityRole="button" testID="customer-map-recenter">
              <Text style={styles.controlText}>Recenter</Text>
            </Pressable>
            <Pressable
              style={styles.control}
              onPress={() => setLegendOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: legendOpen }}
              testID="customer-map-legend-toggle"
            >
              <Text style={styles.controlText}>Legend</Text>
            </Pressable>
          </View>
          {legendOpen ? (
            <View style={styles.legend} testID="customer-map-legend">
              {MAP_LEGEND.map((entry) => (
                <View key={entry.key} style={styles.legendRow}>
                  <View
                    style={
                      entry.symbol === "site" ? styles.legendSite : entry.symbol === "area" ? styles.legendArea : styles.legendYou
                    }
                  >
                    {entry.symbol === "site" ? <Text style={styles.legendLetter}>A</Text> : null}
                  </View>
                  <Text style={styles.legendText}>{entry.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {state.reason ? (
        <Text style={styles.reason} testID="customer-map-reason">
          {state.reason}
        </Text>
      ) : null}
      {locationNote ? <Text style={styles.reason}>{locationNote}</Text> : null}
      <FlatList
        style={styles.list}
        data={sites}
        keyExtractor={(site) => site.siteId}
        ListHeaderComponent={
          sites.length > 0 ? (
            <Text style={styles.listHeading}>
              {[
                sites.length === 1 ? "1 site" : `${sites.length} sites`,
                response && response.notOnMap > 0 ? `${response.notOnMap} not on the map` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => openAccount(item)}
            accessibilityRole="button"
            testID={`customer-map-row-${item.siteId}`}
          >
            <Text style={styles.rowName}>{item.accountName}</Text>
            <Text style={styles.rowMeta}>
              {[item.siteName, item.addressLabel, item.onMap ? null : "not on the map"].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface1 },
    mapFrame: { height: "58%", borderBottomWidth: 1, borderBottomColor: colors.border },
    pin: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    pinLetter: { color: colors.surface1, fontSize: 13, fontWeight: "700" },
    controls: { position: "absolute", left: spacing.sm, bottom: spacing.sm, flexDirection: "row", gap: spacing.sm },
    control: {
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    controlOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    controlText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    controlTextOn: { color: colors.surface1 },
    legend: {
      position: "absolute",
      left: spacing.sm,
      right: spacing.sm,
      bottom: 56,
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    legendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    legendSite: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    legendLetter: { color: colors.surface1, fontSize: 11, fontWeight: "700" },
    legendArea: { width: 20, height: 14, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary + "26" },
    legendYou: { width: 14, height: 14, borderRadius: 7, marginHorizontal: 3, backgroundColor: NATIVE_PUCK_BLUE, borderWidth: 2, borderColor: colors.white },
    legendText: { color: colors.text, fontSize: 13, flex: 1 },
    reason: { color: colors.textMuted, fontSize: 14, marginHorizontal: spacing.md, marginTop: spacing.md },
    list: { flex: 1 },
    listHeading: { color: colors.textMuted, fontSize: 13, marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
    row: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    rowName: { color: colors.text, fontSize: 15, fontWeight: "600" },
    rowMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  });
}
