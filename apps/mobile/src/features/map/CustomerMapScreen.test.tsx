import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { CustomerSitesMapResponse } from "@dpf/types";
import CustomerMapScreen from "@/app/(tabs)/customers/map";

const mockPush = jest.fn();
const mockCustomerSites = jest.fn();
const mockAddHeader = jest.fn();
const mockRemoveHeader = jest.fn();
const mockRequestPermission = jest.fn();
const mockFitBounds = jest.fn();
const mockCameraProps = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
}));
jest.mock("@/src/lib/apiClient", () => ({ api: { map: { customerSites: () => mockCustomerSites() } } }));
jest.mock("@/src/repositories/SecureStorage", () => ({
  SecureStorage: { getAccessToken: async () => "token-1" },
}));
jest.mock("@/src/lib/serverConfig", () => ({ getServerUrl: () => "https://dpf.example" }));
jest.mock("@maplibre/maplibre-react-native", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { View, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Map: ({ children }: { children: React.ReactNode }) => <View testID="native-map">{children}</View>,
    Camera: ReactActual.forwardRef((props: Record<string, unknown>, ref) => {
      mockCameraProps(props);
      ReactActual.useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds }));
      return null;
    }),
    UserLocation: () => <View testID="native-user-location" />,
    Marker: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>{children}</Pressable>
    ),
    TransformRequestManager: {
      addHeader: (options: unknown) => mockAddHeader(options),
      removeHeader: (id: string) => mockRemoveHeader(id),
    },
  };
});

const payload: CustomerSitesMapResponse = {
  model: {
    viewport: { latitude: 30.27, longitude: -97.74, zoom: 10 },
    bounds: { west: -97.8, south: 30.2, east: -97.7, north: 30.3, crossesAntimeridian: false },
    zones: { type: "FeatureCollection", features: [] },
    placements: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "site:s1",
          geometry: { type: "Point", coordinates: [-97.74, 30.27] },
          properties: {
            featureId: "site:s1",
            featureKind: "placement",
            label: "Acme",
            entityKind: "customer-site",
            entityId: "s1",
            selected: false,
            statusLabel: null,
            sublabel: null,
            intent: null,
          },
        },
      ],
    },
  },
  notOnMap: 0,
  sites: [{ siteId: "s1", siteName: "HQ", accountId: "acct-1", accountName: "Acme", addressLabel: "1 Main", onMap: true }],
  pack: { packId: "us-texas", attribution: "© OpenStreetMap contributors", bounds: { west: -107, south: 25, east: -93, north: 37 } },
  basemap: "available",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCustomerSites.mockResolvedValue(payload);
  mockRequestPermission.mockResolvedValue({ status: "granted" });
});

describe("Customer map screen (AC-PMR-SCREEN-1)", () => {
  it("draws lettered sites and sends the token to the install's origin only", async () => {
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("native-map")).toBeTruthy());
    expect(screen.getByTestId("customer-map-site-s1")).toHaveTextContent("A");
    expect(mockAddHeader).toHaveBeenCalledWith({
      id: "dpf-install-bearer",
      match: "^https://dpf\\.example/",
      name: "Authorization",
      value: "Bearer token-1",
    });
  });

  it("opens the site's account when the marker is tapped", async () => {
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-site-s1")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("customer-map-site-s1"));
    expect(mockPush).toHaveBeenCalledWith("/customers/acct-1");
  });

  it("follows the device once location is granted, and recenters on the sites", async () => {
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-follow")).toBeTruthy());
    expect(screen.queryByTestId("native-user-location")).toBeNull();
    await fireEvent.press(screen.getByTestId("customer-map-follow"));
    await waitFor(() => expect(screen.getByTestId("native-user-location")).toBeTruthy());
    expect(mockCameraProps).toHaveBeenLastCalledWith(expect.objectContaining({ trackUserLocation: "default" }));

    await fireEvent.press(screen.getByTestId("customer-map-recenter"));
    expect(mockFitBounds).toHaveBeenCalledWith([-97.8, 30.2, -97.7, 30.3], expect.anything());
    await waitFor(() => expect(screen.queryByTestId("native-user-location")).toBeNull());
  });

  it("says why Follow me is off when location is refused", async () => {
    mockRequestPermission.mockResolvedValue({ status: "denied" });
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-follow")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("customer-map-follow"));
    await waitFor(() => expect(screen.getByText(/Turn on location/)).toBeTruthy());
    expect(screen.queryByTestId("native-user-location")).toBeNull();
  });

  it("shows the legend in the screen", async () => {
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-legend-toggle")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("customer-map-legend-toggle"));
    expect(screen.getByTestId("customer-map-legend")).toHaveTextContent(/Customer site.*Service area.*Follow me/);
  });
});

describe("Customer map fallback (AC-PMR-FALLBACK-1)", () => {
  it("lists the sites with the reason when the map cannot load", async () => {
    mockCustomerSites.mockRejectedValue(new Error("offline"));
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-reason")).toHaveTextContent(/offline/));
    expect(screen.queryByTestId("native-map")).toBeNull();
  });

  it("keeps the map on a plain background, with the reason and the list, when no pack covers the sites", async () => {
    mockCustomerSites.mockResolvedValue({ ...payload, pack: null, basemap: "no-pack-installed" });
    const screen = await render(<CustomerMapScreen />);
    await waitFor(() => expect(screen.getByTestId("customer-map-reason")).toHaveTextContent(/No street map/));
    expect(screen.getByTestId("native-map")).toBeTruthy();
    expect(screen.getByTestId("customer-map-row-s1")).toBeTruthy();
  });
});
