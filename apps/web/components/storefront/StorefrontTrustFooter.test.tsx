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

  // IMP-034: both storefront surfaces hand-joined a subset of address keys and
  // dropped the state. It survived because every fixture here was a UK address
  // (Bristol, BS1 1AA) which HAS no state — the test could not fail on a bug the
  // data never exercised. A US address is the case that matters: "Fort Worth,
  // 76106" without TX is not a usable business address.
  it("includes the state for a US address", () => {
    const html = renderToStaticMarkup(
      <StorefrontTrustFooter
        storefront={{
          ...base,
          orgAddress: {
            line1: "4820 Ridgeline Parkway",
            city: "Fort Worth",
            region: "Texas",
            stateCode: "TX",
            postalCode: "76106",
            country: "United States",
          },
        }}
        hours={hours}
      />,
    );
    expect(html).toContain("Texas");
    expect(html).toContain("Fort Worth");
    expect(html).toContain("76106");
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
