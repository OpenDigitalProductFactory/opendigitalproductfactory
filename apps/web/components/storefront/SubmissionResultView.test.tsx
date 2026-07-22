// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionResultView } from "./SubmissionResultView";
import type { SubmissionResultModel } from "@/lib/storefront/submission-result";

const INQUIRY: SubmissionResultModel = {
  type: "inquiry",
  ref: "INQ-ABC123",
  orgName: "Bella Trattoria",
  orgSlug: "bella-trattoria",
  heading: "Thanks — we've received your enquiry",
  icon: "✉️",
  context: [
    { label: "Name", value: "UX Study Guest" },
    { label: "Email", value: "guest@example.com" },
    { label: "Your message", value: "Do you cater for gluten-free?" },
  ],
  responseChannel: "We'll reply by email to guest@example.com.",
  responseTime: "We aim to respond within one business day.",
  nextSteps: [
    "A member of the Bella Trattoria team reads your enquiry.",
    "We reply using the contact details you gave us.",
    "We'll confirm anything we need before going ahead.",
  ],
  contact: { email: "hello@bella.example", phone: "+44 20 1234 5678" },
};

function html(model: SubmissionResultModel): string {
  return renderToStaticMarkup(<SubmissionResultView result={model} />);
}

describe("SubmissionResultView", () => {
  it("shows the reference prominently", () => {
    expect(html(INQUIRY)).toContain("INQ-ABC123");
  });

  it("shows the submitted context (name, email, message)", () => {
    const out = html(INQUIRY);
    expect(out).toContain("UX Study Guest");
    expect(out).toContain("guest@example.com");
    expect(out).toContain("Do you cater for gluten-free?");
  });

  it("explains response channel and expected time", () => {
    const out = html(INQUIRY);
    expect(out).toContain("We&#x27;ll reply by email to guest@example.com.");
    expect(out).toContain("aim to respond within one business day");
  });

  it("lists what happens next", () => {
    const out = html(INQUIRY);
    expect(out).toContain("What happens next");
    expect(out).toContain("reads your enquiry");
  });

  it("offers correction/cancel/contact affordances", () => {
    const out = html(INQUIRY);
    expect(out).toContain("Need to change or cancel?");
    expect(out).toContain("mailto:hello@bella.example");
    expect(out).toContain("tel:+44 20 1234 5678");
  });

  it("provides a branded return link to the storefront", () => {
    const out = html(INQUIRY);
    expect(out).toContain('href="/s/bella-trattoria"');
    expect(out).toContain("Back to Bella Trattoria");
  });

  it("gracefully omits the contact block when no channels are configured", () => {
    const out = html({ ...INQUIRY, contact: { email: null, phone: null } });
    expect(out).not.toContain("mailto:");
    expect(out).not.toContain("tel:");
    // Still tells the customer how to change/cancel via their reference.
    expect(out).toContain("Need to change or cancel?");
  });
});
