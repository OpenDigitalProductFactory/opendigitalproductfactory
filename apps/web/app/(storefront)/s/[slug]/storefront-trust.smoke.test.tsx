// @vitest-environment jsdom
//
// Route-level smoke coverage for the public Restaurant storefront trust work
// (BI-4A68EDF6): brand-inheriting metadata, item/booking trust context, gated
// donation/order journeys, customer-safe confirmation, and auth vocabulary.
// Child form/flow components and the data layer are mocked so each test asserts
// the trust content this BI added, not the forms owned by sibling PRs.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// ── shared mocks ────────────────────────────────────────────────────────────
class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/link", () => ({
  // Forward ALL props (href, aria-label, …) like the real Link.
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const getPublicStorefront = vi.fn();
const getPublicItem = vi.fn();
const resolveInquiryFormSchema = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/storefront-data", () => ({
  getPublicStorefront: (...a: unknown[]) => getPublicStorefront(...a),
  getPublicItem: (...a: unknown[]) => getPublicItem(...a),
  resolveInquiryFormSchema: (...a: unknown[]) => resolveInquiryFormSchema(...a),
}));
const loadPublicRestaurantAvailabilityBySlugSafe = vi.fn();
vi.mock("@/lib/twin/restaurant-floor-loader.server", () => ({
  loadPublicRestaurantAvailabilityBySlugSafe: (...a: unknown[]) =>
    loadPublicRestaurantAvailabilityBySlugSafe(...a),
}));

// Prisma is only touched by donate (orgSettings) and checkout; give it a
// per-model mock surface the tests configure.
const prismaMock = {
  orgSettings: { findFirst: vi.fn() },
  storefrontConfig: { findFirst: vi.fn() },
  storefrontBooking: { findFirst: vi.fn() },
  storefrontInquiry: { findFirst: vi.fn() },
  storefrontDonation: { findFirst: vi.fn() },
  storefrontOrder: { findFirst: vi.fn() },
  businessProfile: { findFirst: vi.fn() },
};
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

// Stub the child forms/flows — owned by sibling PRs, not under test here.
vi.mock("@/components/storefront/SlotBookingFlow", () => ({ SlotBookingFlow: () => <div data-test="slot-flow" /> }));
vi.mock("@/components/storefront/SignInForm", () => ({
  SignInForm: ({ returnTo }: { returnTo?: string }) => (
    <form data-test="signin" data-return-to={returnTo ?? ""} />
  ),
}));
vi.mock("@/components/storefront/SignUpForm", () => ({
  SignUpForm: ({ returnTo }: { returnTo?: string }) => (
    <form data-test="signup" data-return-to={returnTo ?? ""} />
  ),
}));
vi.mock("@/components/storefront/InquiryForm", () => ({ InquiryForm: () => <form data-test="inquiry" /> }));
vi.mock("@/components/storefront/OrderForm", () => ({ OrderForm: () => <form data-test="order" /> }));
vi.mock("@/components/storefront/DonationForm", () => ({ DonationForm: () => <form data-test="donation" /> }));
vi.mock("@/lib/finance/currency-symbol", () => ({ getCurrencySymbol: () => "$" }));

const RESTAURANT = {
  orgName: "The Copper Kettle",
  orgSlug: "copper-kettle",
  tagline: "Seasonal British dining",
  description: null,
  archetypeId: "restaurant",
  archetypeCategory: "food-hospitality",
  contactEmail: "hello@copper.example",
  contactPhone: null,
  orgLogoUrl: null,
  timezone: "Europe/London",
  items: [{ ctaType: "booking", priceAmount: null }],
  sections: [],
};

const params = <T,>(o: T): Promise<T> => Promise.resolve(o);

async function renderPage(el: Promise<React.ReactElement> | React.ReactElement) {
  return renderToStaticMarkup(await el);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveInquiryFormSchema.mockResolvedValue([]);
  loadPublicRestaurantAvailabilityBySlugSafe.mockResolvedValue(null);
});

// ── layout metadata (brand inheritance) ─────────────────────────────────────
describe("storefront metadata inherits business brand", () => {
  it("titles pages with the storefront name + tagline, not the platform default", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const { generateMetadata } = await import("./layout");
    const meta = await generateMetadata({ params: params({ slug: "copper-kettle" }) });
    expect(meta.title).toEqual({ default: "The Copper Kettle", template: "%s · The Copper Kettle" });
    expect(meta.description).toBe("Seasonal British dining");
  });
});

// ── item page trust context ─────────────────────────────────────────────────
describe("item page", () => {
  it("explains what happens next and links to the booking policy", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    getPublicItem.mockResolvedValue({
      id: "x", itemId: "itm-1", name: "Table for 2", description: "Reserve a table for two guests",
      ctaType: "booking", ctaLabel: null, priceAmount: null, imageUrl: null,
    });
    const Page = (await import("./item/[itemId]/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle", itemId: "itm-1" }) }));
    expect(html).toContain("What happens next");
    expect(html).toContain("confirm your reservation");
    expect(html).toContain('aria-label="Book Now: Table for 2"');
    expect(html).toContain("/s/copper-kettle/policies");
  });
});

// ── booking page trust context ──────────────────────────────────────────────
describe("booking page", () => {
  it("shows reservation policy, dietary note, cancellation + contact fallback", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    getPublicItem.mockResolvedValue({ id: "x", itemId: "itm-1", name: "Table for 2", ctaType: "booking", bookingConfig: null });
    const Page = (await import("./book/[itemId]/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle", itemId: "itm-1" }) }));
    expect(html).toContain("Reservation request");
    expect(html).toContain("confirmation of your reservation");
    expect(html).toMatch(/allerg/i);
    expect(html).toContain('data-test="slot-flow"');
    expect(html).toContain("/s/copper-kettle/inquire");
  });

  it("renders the customer-safe physical table outlook when it is available", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    getPublicItem.mockResolvedValue({
      id: "x",
      itemId: "itm-1",
      name: "Table for 2",
      ctaType: "booking",
      bookingConfig: null,
    });
    loadPublicRestaurantAvailabilityBySlugSafe.mockResolvedValue({
      asOf: "2026-07-31T18:14:00.000Z",
      summary: { totalTables: 1, availableNow: 0, availableSoon: 1 },
      tables: [
        {
          key: "availability-1",
          capacity: 2,
          shape: "round",
          serviceArea: "Main dining",
          availability: {
            kind: "at",
            availableAt: "2026-07-31T18:35:00.000Z",
            minutes: 21,
            explanation: "Available in about 21 minutes",
          },
        },
      ],
    });

    const Page = (await import("./book/[itemId]/page")).default;
    const html = await renderPage(
      Page({
        params: params({ slug: "copper-kettle", itemId: "itm-1" }),
      }),
    );

    expect(html).toContain("Table availability");
    expect(html).toContain("Available in about 21 minutes");
    expect(
      loadPublicRestaurantAvailabilityBySlugSafe,
    ).toHaveBeenCalledWith(prismaMock, { slug: "copper-kettle" });
  });
});

// ── donation gating ─────────────────────────────────────────────────────────
describe("donation journey gating", () => {
  it("shows a customer-safe unavailable page for a venue with no donation appeal", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT); // booking-only
    prismaMock.orgSettings.findFirst.mockResolvedValue({ baseCurrency: "USD" });
    const Page = (await import("./donate/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle" }) }));
    expect(html).toContain("Donations aren&#x27;t set up here");
    expect(html).not.toContain('data-test="donation"');
    expect(html).toContain("/s/copper-kettle");
  });

  it("renders the donation form when a donation appeal is configured", async () => {
    getPublicStorefront.mockResolvedValue({ ...RESTAURANT, items: [{ ctaType: "donation", priceAmount: null }] });
    prismaMock.orgSettings.findFirst.mockResolvedValue({ baseCurrency: "USD" });
    const Page = (await import("./donate/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle" }) }));
    expect(html).toContain('data-test="donation"');
  });
});

// ── order gating ────────────────────────────────────────────────────────────
describe("order journey gating", () => {
  it("shows a customer-safe unavailable page for a priceless item", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    getPublicItem.mockResolvedValue({ id: "x", itemId: "itm-1", name: "Table for 2", ctaType: "booking", priceAmount: null });
    const Page = (await import("./order/[itemId]/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle", itemId: "itm-1" }) }));
    expect(html).toContain("Online ordering isn&#x27;t available");
    expect(html).not.toContain('data-test="order"');
  });

  it("renders the order form for a priced item", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    getPublicItem.mockResolvedValue({ id: "x", itemId: "itm-1", name: "Sourdough", ctaType: "purchase", priceAmount: "4.50", priceCurrency: "USD" });
    const Page = (await import("./order/[itemId]/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle", itemId: "itm-1" }) }));
    expect(html).toContain('data-test="order"');
    expect(html).toContain("Order: Sourdough");
  });
});

// ── checkout confirmation (inquiry does not look like plumbing) ──────────────
// Success now lives at result-named routes (BI-F20763F5). `/checkout` is a
// back-compat shim that redirects an inquiry to `/inquiry/received`, so the
// customer never lands on a "checkout" URL for a non-purchase action. The rich
// what-happens-next / recovery content is asserted in
// components/storefront/SubmissionResultView.test.tsx.
describe("confirmation page", () => {
  it("redirects an inquiry checkout to its named result route (not checkout plumbing)", async () => {
    const Page = (await import("./checkout/page")).default;
    let redirectUrl: string | null = null;
    try {
      await Page({
        params: params({ slug: "copper-kettle" }),
        searchParams: params({ ref: "INQ-1", type: "inquiry" }),
      });
    } catch (err) {
      if (err instanceof RedirectError) redirectUrl = err.url;
      else throw err;
    }
    expect(redirectUrl).toBe("/s/copper-kettle/inquiry/received?ref=INQ-1");
    expect(redirectUrl).not.toContain("checkout");
    expect(redirectUrl).not.toContain("/workspace");
  });

  it("404s a checkout hit with a missing or unknown type", async () => {
    const Page = (await import("./checkout/page")).default;
    await expect(
      Page({ params: params({ slug: "copper-kettle" }), searchParams: params({ ref: "INQ-1" }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ── auth vocabulary + policy links ──────────────────────────────────────────
describe("customer auth pages", () => {
  it("sign-in inherits brand + reservation vocabulary and links terms/privacy", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const Page = (await import("./sign-in/page")).default;
    const html = await renderPage(
      Page({ params: params({ slug: "copper-kettle" }), searchParams: params({}) }),
    );
    expect(html).toContain("The Copper Kettle");
    expect(html).toMatch(/reservation/i);
    expect(html).toContain("/s/copper-kettle/policies#terms");
    expect(html).toContain("/s/copper-kettle/policies#privacy");
    expect(html).toContain('data-test="signin"');
  });

  it("sign-up inherits brand + vocabulary", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const Page = (await import("./sign-up/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle" }), searchParams: params({}) }));
    expect(html).toContain("Create your The Copper Kettle account");
    expect(html).toMatch(/reservation/i);
    expect(html).toContain('data-test="signup"');
  });

  it("threads returnTo from the URL through to sign-in and sign-up (BI-CC4BEB5F)", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const SignInPage = (await import("./sign-in/page")).default;
    const signInHtml = await renderPage(
      SignInPage({
        params: params({ slug: "copper-kettle" }),
        searchParams: params({ returnTo: "/s/copper-kettle/book/itm-1" }),
      }),
    );
    expect(signInHtml).toContain('data-return-to="/s/copper-kettle/book/itm-1"');

    const SignUpPage = (await import("./sign-up/page")).default;
    const signUpHtml = await renderPage(
      SignUpPage({
        params: params({ slug: "copper-kettle" }),
        searchParams: params({ returnTo: "/s/copper-kettle/book/itm-1" }),
      }),
    );
    expect(signUpHtml).toContain('data-return-to="/s/copper-kettle/book/itm-1"');
  });
});

// ── inquiry + policies pages ────────────────────────────────────────────────
describe("inquiry + policies pages", () => {
  it("inquiry page carries a privacy note", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const Page = (await import("./inquire/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle" }) }));
    expect(html).toContain("/s/copper-kettle/policies#privacy");
    expect(html).toContain('data-test="inquiry"');
  });

  it("policies page renders booking, dietary, privacy and terms for a restaurant", async () => {
    getPublicStorefront.mockResolvedValue(RESTAURANT);
    const Page = (await import("./policies/page")).default;
    const html = await renderPage(Page({ params: params({ slug: "copper-kettle" }) }));
    expect(html).toContain('id="booking"');
    expect(html).toContain('id="dietary"');
    expect(html).toContain('id="privacy"');
    expect(html).toContain('id="terms"');
    expect(html).toContain("The Copper Kettle");
  });
});
