// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { StorefrontTrustFooter } from "./StorefrontTrustFooter";

const base = {
  orgName: "The Copper Kettle",
  orgSlug: "copper-kettle",
  orgAddress: { street: "1 High St", city: "Bristol", postcode: "BS1 1AA", country: "UK" },
  contactEmail: "hello@copper.example",
  contactPhone: "+44 117 000 0000",
  socialLinks: { instagram: "https://instagram.com/copper" },
  timezone: "Europe/London",
} as const;

const hours = {
  monday: { enabled: true, open: "11:00", close: "22:00" },
  tuesday: { enabled: false, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "11:00", close: "22:00" },
  thursday: { enabled: true, open: "11:00", close: "22:00" },
  friday: { enabled: true, open: "11:00", close: "23:00" },
  saturday: { enabled: true, open: "10:00", close: "23:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

describe("StorefrontTrustFooter", () => {
  it("shows location, contact, hours and policy links", () => {
    const html = renderToStaticMarkup(<StorefrontTrustFooter storefront={base} hours={hours} />);
    expect(html).toContain("1 High St, Bristol, BS1 1AA, UK");
    expect(html).toContain("mailto:hello@copper.example");
    expect(html).toContain("tel:+44 117 000 0000");
    expect(html).toContain("11:00–22:00");
    expect(html).toContain("Closed");
    expect(html).toContain("/s/copper-kettle/policies");
    expect(html).toContain("/s/copper-kettle/policies#privacy");
    expect(html).toContain("/s/copper-kettle/policies#terms");
  });

  it("degrades gracefully when hours/contact/address are missing", () => {
    const html = renderToStaticMarkup(
      <StorefrontTrustFooter
        storefront={{ ...base, orgAddress: null, contactEmail: null, contactPhone: null, socialLinks: null }}
        hours={null}
      />,
    );
    expect(html).toContain("Contact us for current opening hours.");
    expect(html).toContain("Contact us for location details.");
    // With no email/phone, still offer a way to reach the business.
    expect(html).toContain("/s/copper-kettle/inquire");
  });
});
