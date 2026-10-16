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
});
