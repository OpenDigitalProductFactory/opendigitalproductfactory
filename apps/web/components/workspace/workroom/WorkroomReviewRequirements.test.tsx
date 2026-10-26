import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { DEFAULT_LOCALE, namespaceMessages } from "@dpf/i18n";
import { describe, expect, it } from "vitest";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { composeRoomReviewProfile } from "@/lib/work-management/room-review-profile";
import { WorkroomReviewRequirements } from "./WorkroomReviewRequirements";

const renderToStaticMarkup = (node: ReactNode, locale = DEFAULT_LOCALE) => renderMarkup(
  <MessagesProvider locale={locale} messages={{ workrooms: namespaceMessages(locale, "workrooms") }}>{node}</MessagesProvider>,
);

describe("Workroom review requirements", () => {
  it.each(["en-XA", "ar-XB"])("uses the viewer's %s messages while retaining authored evidence", (locale) => {
    const source = composeRoomReviewProfile("booking", []);
    const html = renderToStaticMarkup(<WorkroomReviewRequirements profile={{
      source, applicability: "unknown", assessment: "not-exercised",
    }} />, locale);
    expect(html).not.toContain(">Review requirements</summary>");
    expect(html).not.toContain(">Did the change help?</summary>");
    expect(html).toContain(source.requirements[0].outcome);
    expect(html).toContain(locale === "en-XA" ? "⟦" : "\u202e");
  });

  it("keeps unsupported identity explicit while preserving inherited common requirements", () => {
    const source = composeRoomReviewProfile("unregistered-source", []);
    const html = renderToStaticMarkup(<WorkroomReviewRequirements profile={{
      source, applicability: "unknown", assessment: "not-exercised",
    }} />);
    expect(html).toContain("This source has no supported review profile.");
    expect(html).toContain("eligible occurrences including unsuccessful and interrupted work");
    expect(html).toContain("Not yet assessed");
    expect(html).not.toContain("Review passed");
  });

  it("renders hostile evidence and provenance as text, without executable markup", () => {
    const source = composeRoomReviewProfile("booking", []);
    source.requirements[0].outcome = '<script>grant_everything()</script>';
    source.requirements[0].provenance = ['<img src=x onerror="approve()">'];
    const html = renderToStaticMarkup(<WorkroomReviewRequirements profile={{
      source, applicability: "unknown", assessment: "not-exercised",
    }} />);
    expect(html).toContain("&lt;script&gt;grant_everything()&lt;/script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("No independent assessment is available in this view.");
  });

  it("discloses bounded evidence age and the strict denominator without a success metric", () => {
    const source = composeRoomReviewProfile("booking", [{
      ref: "org:period@1", kind: "organization", requirements: [{
        ref: "fresh-evidence", outcome: "Retain current source evidence",
        denominator: "all due work, including excluded and unknown cases",
        evidence: ["source-receipt"], criticalFailures: ["stale-evidence"], maxAgeSeconds: 60,
      }],
    }]);
    const html = renderToStaticMarkup(<WorkroomReviewRequirements profile={{
      source, applicability: "unknown", assessment: "not-exercised",
    }} />);
    expect(html).toContain("60 seconds");
    expect(html).toContain("all due work, including excluded and unknown cases");
    expect(html).toContain("A recorded receipt or closed cycle alone does not establish improvement.");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("<details open");
  });

  it("shows source context inside the existing identity disclosure without presenting applicability as passed", () => {
    const source = composeRoomReviewProfile("booking", []);
    const subject = { status: "resolved" as const, organizationId: "org-example", storefrontId: "sf-example",
      storefrontRevision: "2026-10-25T00:00:00.000Z",
      source: { sourceKey: "booking" as const, sourceId: "BK-example", revision: "2026-10-25T00:00:00.000Z" },
      primary: { ref: "arch-example", slug: "campground", category: "hospitality", revision: "2026-10-25T00:00:00.000Z" },
      compositions: [], fingerprint: "context-identity" };
    const previous = renderToStaticMarkup(<WorkroomReviewRequirements profile={{ source, applicability: "unknown", assessment: "not-exercised" }} />);
    const html = renderToStaticMarkup(<WorkroomReviewRequirements profile={{ source, subject, applicability: "unknown", assessment: "not-exercised" }} />);
    expect(html).toContain("Organization context");
    expect(html).toContain("org-example");
    expect(html).toContain("campground");
    expect(html).toContain("Review applicability remains unresolved.");
    expect(html).toContain("context-identity");
    expect(html).not.toContain("Review passed");
    expect(html.match(/<summary/g)?.length).toBe(previous.match(/<summary/g)?.length);
    expect(html).not.toContain("<details open");
    const pseudo = renderToStaticMarkup(<WorkroomReviewRequirements profile={{ source, subject, applicability: "unknown", assessment: "not-exercised" }} />, "ar-XB");
    expect(pseudo).toContain("org-example");
    expect(pseudo).not.toContain(">Organization context</dt>");
  });

  it("uses the same safe context message for denied and unavailable source details", () => {
    const source = composeRoomReviewProfile("booking", []);
    const denied = renderToStaticMarkup(<WorkroomReviewRequirements profile={{ source,
      subject: { status: "unknown", reason: "source-denied" }, applicability: "unknown", assessment: "not-exercised" }} />);
    const unavailable = renderToStaticMarkup(<WorkroomReviewRequirements profile={{ source,
      subject: { status: "unknown", reason: "source-unavailable" }, applicability: "unknown", assessment: "not-exercised" }} />);
    expect(denied).toContain("The source record");
    expect(denied).toContain("organization context is unavailable.");
    expect(denied).toBe(unavailable);
    expect(denied).not.toContain("source-denied");
  });
});
