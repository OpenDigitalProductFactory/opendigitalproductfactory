// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { InquiryReceived } from "./InquiryReceived";

function markup(overrides: Partial<Parameters<typeof InquiryReceived>[0]> = {}) {
  return renderToStaticMarkup(
    <InquiryReceived
      orgName="The Copper Table"
      orgSlug="copper-table"
      reference="INQ-FGQXCF4X"
      customerName="UX Study Guest"
      customerEmail="ux-study@example.invalid"
      details={[
        { label: "About", value: "Table for 2" },
        { label: "Party size", value: "2" },
        { label: "Message", value: "Anniversary dinner" },
      ]}
      contactEmail="hello@copper-table.example"
      contactPhone="+44 20 7946 0000"
      {...overrides}
    />,
  );
}

describe("InquiryReceived — submit-result contract", () => {
  it("shows the reference prominently", () => {
    expect(markup()).toContain("INQ-FGQXCF4X");
  });

  it("echoes the submitted context back to the customer", () => {
    const html = markup();
    expect(html).toContain("UX Study Guest");
    expect(html).toContain("ux-study@example.invalid");
    expect(html).toContain("Table for 2");
    expect(html).toContain("Party size");
    expect(html).toContain("Anniversary dinner");
  });

  it("names the response channel and expected time", () => {
    const html = markup();
    expect(html).toMatch(/What happens next/i);
    expect(html).toMatch(/reply to you by email/i);
    expect(html).toMatch(/one business day/i);
  });

  it("gives a correction/cancel path via the business contact channels", () => {
    const html = markup();
    expect(html).toMatch(/change or cancel/i);
    expect(html).toContain("mailto:hello@copper-table.example");
    expect(html).toContain("tel:+442079460000");
  });

  it("does not overpromise a confirmation email that is never sent", () => {
    expect(markup()).not.toMatch(/check your (inbox|email) for/i);
  });

  it("falls back to a reply-when-contacted message when no contact channels exist", () => {
    const html = markup({ contactEmail: null, contactPhone: null });
    // renderToStaticMarkup escapes the apostrophe to &#x27;, so match either form.
    expect(html).toMatch(/reply to the team(&#x27;|')s email/i);
    expect(html).toMatch(/email when they get in touch/i);
    expect(html).not.toContain("mailto:");
  });

  it("offers a route back to the storefront", () => {
    expect(markup()).toContain('href="/s/copper-table"');
  });
});
