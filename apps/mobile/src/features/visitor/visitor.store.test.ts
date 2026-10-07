import {
  MENU_NOT_FOUND_MESSAGE,
  MENU_UNAVAILABLE_MESSAGE,
  NEARBY_UNAVAILABLE_MESSAGE,
  orderForDisplay,
  useVisitorStore,
} from "./visitor.store";
import type { NearbyBusiness, PublicMenu } from "@dpf/types";

const mockNearby = jest.fn();
const mockMenu = jest.fn();
jest.mock("@/src/lib/apiClient", () => ({
  api: {
    storefront: {
      nearby: (...a: unknown[]) => mockNearby(...a),
      menu: (...a: unknown[]) => mockMenu(...a),
    },
  },
}));

const biz = (slug: string, hasMenu = true): NearbyBusiness => ({
  slug,
  name: slug,
  category: "food-hospitality",
  archetypeId: "food-hospitality/restaurant",
  distanceMeters: 100,
  hasMenu,
  addressLine: "1 Main St",
});

const MENU: PublicMenu = {
  slug: "corner-table",
  name: "The Corner Table",
  category: "food-hospitality",
  categories: [
    { category: "Mains", items: [{ id: "1", name: "Pizza", description: null, category: "Mains", price: 14, currency: "USD", imageUrl: null }] },
  ],
};

function reset() {
  useVisitorStore.getState().reset();
  mockNearby.mockReset();
  mockMenu.mockReset();
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("useVisitorStore.fetchNearby", () => {
  beforeEach(reset);

  it("forwards the coordinate and populates businesses", async () => {
    mockNearby.mockResolvedValueOnce({ businesses: [biz("a")] });
    await useVisitorStore.getState().fetchNearby({ latitude: 37.8, longitude: -122.4 });
    expect(mockNearby.mock.calls[0][0]).toEqual({ latitude: 37.8, longitude: -122.4 });
    expect(useVisitorStore.getState().businesses).toHaveLength(1);
    expect(useVisitorStore.getState().isLoadingNearby).toBe(false);
  });

  // What React Native's fetch throws when the server can't be reached; this
  // exact text used to reach the "Right here" screen.
  it("maps a network failure to a plain-language message and clears loading", async () => {
    mockNearby.mockRejectedValueOnce(
      new TypeError("fetch failed: Could not connect to the server."),
    );
    await useVisitorStore.getState().fetchNearby({ latitude: 1, longitude: 2 });
    expect(useVisitorStore.getState().nearbyError).toBe(NEARBY_UNAVAILABLE_MESSAGE);
    expect(useVisitorStore.getState().isLoadingNearby).toBe(false);
  });

  it("maps an API error to the same message", async () => {
    mockNearby.mockRejectedValueOnce({ code: "INTERNAL", message: "HTTP 500" });
    await useVisitorStore.getState().fetchNearby({ latitude: 1, longitude: 2 });
    expect(useVisitorStore.getState().nearbyError).toBe(NEARBY_UNAVAILABLE_MESSAGE);
  });
});

describe("useVisitorStore.fetchMenu", () => {
  beforeEach(reset);

  it("loads a menu for a slug", async () => {
    mockMenu.mockResolvedValueOnce(MENU);
    await useVisitorStore.getState().fetchMenu("corner-table");
    expect(mockMenu.mock.calls[0][0]).toBe("corner-table");
    expect(useVisitorStore.getState().menu?.name).toBe("The Corner Table");
  });

  it("clears any stale menu before the new one loads (no cross-business bleed)", async () => {
    useVisitorStore.setState({ menu: MENU });
    let menuDuringLoad: PublicMenu | null = MENU;
    mockMenu.mockImplementationOnce(async () => {
      menuDuringLoad = useVisitorStore.getState().menu;
      return { ...MENU, slug: "other", name: "Other" };
    });
    await useVisitorStore.getState().fetchMenu("other");
    expect(menuDuringLoad).toBeNull();
    expect(useVisitorStore.getState().menu?.slug).toBe("other");
  });

  it("maps a menu failure to a plain-language message", async () => {
    mockMenu.mockRejectedValueOnce(
      new TypeError("fetch failed: Could not connect to the server."),
    );
    await useVisitorStore.getState().fetchMenu("gone");
    expect(useVisitorStore.getState().menuError).toBe(MENU_UNAVAILABLE_MESSAGE);
    expect(useVisitorStore.getState().menu).toBeNull();
  });

  // The connection is fine here; the business has no published menu.
  it("says the menu isn't available when the API reports it not found", async () => {
    mockMenu.mockRejectedValueOnce({
      code: "NOT_FOUND",
      message: "Storefront not found or not published",
    });
    await useVisitorStore.getState().fetchMenu("gone");
    expect(useVisitorStore.getState().menuError).toBe(MENU_NOT_FOUND_MESSAGE);
  });
});

describe("orderForDisplay", () => {
  it("sorts businesses with a menu ahead of those without, order otherwise stable", () => {
    const out = orderForDisplay([biz("no", false), biz("yes1"), biz("no2", false), biz("yes2")]);
    expect(out.map((b) => b.slug)).toEqual(["yes1", "yes2", "no", "no2"]);
  });
});
