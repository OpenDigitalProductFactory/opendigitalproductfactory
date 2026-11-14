// Lives outside app/ because every file under app/ becomes an expo-router route.
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import type { PublicMenu } from "@dpf/types";
import NearbyMenuScreen from "@/app/(tabs)/nearby/[slug]";
import {
  MENU_UNAVAILABLE_MESSAGE,
  useVisitorStore,
} from "@/src/features/visitor/visitor.store";
import { EMPTY_CART, MAX_QUANTITY_PER_LINE } from "@/src/features/visitor/cart";

const mockFetchMenu = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ slug: "corner-table" }),
}));

// Keep the API client (and its native storage) out so expo's runtime globals
// are never installed.
jest.mock("@/src/lib/apiClient", () => ({ api: {} }));

const item = (id: string, name: string, price: number | null, currency = "USD") => ({
  id,
  name,
  description: null,
  price,
  currency,
});

const MENU = {
  slug: "corner-table",
  name: "Corner Table",
  category: null,
  categories: [
    {
      category: "Mains",
      items: [item("a", "Soup", 4.5), item("b", "Bread", 2.25), item("c", "Mystery", null)],
    },
  ],
} as unknown as PublicMenu;

function seed(state: Partial<ReturnType<typeof useVisitorStore.getState>> = {}) {
  useVisitorStore.setState({
    ...useVisitorStore.getState(),
    menu: MENU,
    isLoadingMenu: false,
    menuError: null,
    cart: EMPTY_CART,
    fetchMenu: mockFetchMenu,
    ...state,
  });
}

describe("NearbyMenuScreen load failure", () => {
  beforeEach(() => {
    mockFetchMenu.mockReset();
    seed({ menu: null, menuError: MENU_UNAVAILABLE_MESSAGE });
  });

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

describe("NearbyMenuScreen cart", () => {
  beforeEach(() => {
    mockFetchMenu.mockReset();
    seed();
  });

  it("adds an item and shows quantity, count and total immediately", async () => {
    const { getByLabelText, getByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Add Soup to cart"));
    expect(getByTestId("cart-qty-a")).toHaveTextContent("1");
    expect(getByLabelText("Quantity of Soup: 1")).toBeTruthy();
    expect(getByTestId("cart-summary")).toHaveTextContent(/1 item/);
    expect(getByTestId("cart-summary")).toHaveTextContent(/\$4\.50/);
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe(
      "Cart: 1 item, total $4.50",
    );
    expect(getByTestId("cart-summary").props.accessibilityLiveRegion).toBe("polite");
  });

  it("increases and decreases quantity and removes the line at zero", async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Add Soup to cart"));
    await fireEvent.press(getByLabelText("Increase quantity of Soup"));
    expect(getByTestId("cart-qty-a")).toHaveTextContent("2");
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe(
      "Cart: 2 items, total $9.00",
    );
    await fireEvent.press(getByLabelText("Add Bread to cart"));
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe(
      "Cart: 3 items, total $11.25",
    );
    await fireEvent.press(getByLabelText("Decrease quantity of Soup"));
    await fireEvent.press(getByLabelText("Decrease quantity of Soup"));
    expect(queryByTestId("cart-qty-a")).toBeNull();
    expect(getByLabelText("Add Soup to cart")).toBeTruthy();
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe(
      "Cart: 1 item, total $2.25",
    );
  });

  it("marks buttons as buttons with at least 44x44 touch targets", async () => {
    const { getByLabelText } = await render(<NearbyMenuScreen />);
    const add = getByLabelText("Add Soup to cart");
    expect(add.props.accessibilityRole).toBe("button");
    // Pressable resolves function styles to {} under the test renderer, so the
    // 44x44 floor is asserted on the static-style (disabled) control that shares styles.control.
    expect(getByLabelText("Add Mystery to cart, unavailable to order")).toHaveStyle({ minWidth: 44, minHeight: 44 });
  });

  it("shows unavailable items as not orderable with a disabled add control", async () => {
    const { getByLabelText, getByTestId } = await render(<NearbyMenuScreen />);
    expect(getByTestId("menu-item-c")).toHaveTextContent(/Unavailable to order/);
    const add = getByLabelText("Add Mystery to cart, unavailable to order");
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(add);
    expect(useVisitorStore.getState().cart.lines).toHaveLength(0);
  });

  it("announces a limit rejection in an alert region and leaves the cart unchanged", async () => {
    seed({
      cart: {
        businessSlug: "corner-table",
        currency: "USD",
        lines: [
          { itemId: "a", name: "Soup", currency: "USD", unitMinor: 450, quantity: MAX_QUANTITY_PER_LINE },
        ],
      },
    });
    const { getByLabelText, getByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Increase quantity of Soup"));
    const msg = getByTestId("cart-message");
    expect(msg.props.accessibilityRole).toBe("alert");
    expect(msg).toHaveTextContent(/99/);
    expect(getByTestId("cart-qty-a")).toHaveTextContent("99");
  });

  it("clears the message after a successful change", async () => {
    seed({
      cart: {
        businessSlug: "corner-table",
        currency: "USD",
        lines: [{ itemId: "a", name: "Soup", currency: "USD", unitMinor: 450, quantity: 99 }],
      },
    });
    const { getByLabelText, getByTestId, queryByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Increase quantity of Soup"));
    expect(getByTestId("cart-message")).toBeTruthy();
    await fireEvent.press(getByLabelText("Decrease quantity of Soup"));
    expect(queryByTestId("cart-message")).toBeNull();
  });

  it("shows a rounding-safe total for prices that are inexact in binary", async () => {
    const tricky = {
      ...MENU,
      categories: [{ category: "Mains", items: [item("t", "Tea", 19.99), item("u", "Mint", 0.1)] }],
    } as unknown as PublicMenu;
    seed({ menu: tricky });
    const { getByLabelText, getByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Add Tea to cart"));
    await fireEvent.press(getByLabelText("Increase quantity of Tea"));
    await fireEvent.press(getByLabelText("Increase quantity of Tea"));
    await fireEvent.press(getByLabelText("Add Mint to cart"));
    await fireEvent.press(getByLabelText("Increase quantity of Mint"));
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe(
      "Cart: 5 items, total $60.17",
    );
  });

  it("rejects a stale add with a message and leaves the cart unchanged", async () => {
    seed({
      addItem: () => ({ ok: false, code: "ITEM_NOT_FOUND" }),
    } as unknown as Partial<ReturnType<typeof useVisitorStore.getState>>);
    const { getByLabelText, getByTestId, queryByTestId } = await render(<NearbyMenuScreen />);
    await fireEvent.press(getByLabelText("Add Soup to cart"));
    const msg = getByTestId("cart-message");
    expect(msg.props.accessibilityRole).toBe("alert");
    expect(msg).toHaveTextContent(/no longer on the menu/);
    expect(queryByTestId("cart-qty-a")).toBeNull();
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe("Cart: 0 items, total $0.00");
  });

  it("shows no summary total while the cart is empty", async () => {
    const { getByTestId } = await render(<NearbyMenuScreen />);
    expect(getByTestId("cart-summary").props.accessibilityLabel).toBe("Cart: 0 items, total $0.00");
  });
});


describe("nearby route contract", () => {
  // These run in the focused Jest pass, so a renamed or unregistered route
  // fails here rather than only on a device.
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const dir = path.join(__dirname, "..", "app", "(tabs)", "nearby");

  it("has the files the list screen's /nearby/<slug> push resolves to", () => {
    expect(fs.existsSync(path.join(dir, "index.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "[slug].tsx"))).toBe(true);
  });

  it("registers both screens in the stack layout", () => {
    const layout = fs.readFileSync(path.join(dir, "_layout.tsx"), "utf8");
    expect(layout).toContain('name="index"');
    expect(layout).toContain('name="[slug]"');
  });

  it("pushes the encoded slug route from the list screen", () => {
    const list = fs.readFileSync(path.join(dir, "index.tsx"), "utf8");
    expect(list).toContain("`/nearby/${encodeURIComponent(item.slug)}`");
  });
});
