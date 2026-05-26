import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AcquisitionSignalRouter } from "./AcquisitionSignalRouter";
import type { AcquisitionSignalWorkspace } from "@/lib/crm/acquisition-signals";

const workspace: AcquisitionSignalWorkspace = {
  summary: {
    observedCount: 2,
    routeReadyCount: 1,
    linkedCount: 1,
    needsContactCount: 0,
  },
  signals: [
    {
      id: "inq-1",
      kind: "storefront_inquiry",
      source: "web_inquiry",
      sourceRefId: "inq-1",
      title: "Website inquiry from Bea Buyer",
      summary: "Can you help with managed IT onboarding?",
      buyerLabel: "Bea Buyer",
      channelLabel: "Storefront inquiry",
      observedAtLabel: "26 May 2026",
      routingState: "route_ready",
      routingLabel: "Ready to create engagement",
      routingTone: "accent",
      evidence: ["Ref INQ-1001", "bea@example.com"],
      contactLabel: "Bea Buyer",
      accountLabel: "Acme Ops",
      linkedEngagement: null,
      routeAction: {
        title: "Website inquiry from Bea Buyer",
        contactId: "contact-1",
        accountId: "acct-1",
        source: "web_inquiry",
        sourceRefId: "inq-1",
        notes: "Source: storefront inquiry",
      },
      integrationHref: null,
      aiTopics: [
        {
          id: "signal-summary",
          label: "Summarize signal",
          description: "Review source evidence and recommend the next internal action.",
          prompt: "Summarize this signal.",
          contextSummary: "Storefront inquiry",
          expectedNextStep: "Return a short signal summary.",
        },
      ],
    },
    {
      id: "inq-2",
      kind: "storefront_inquiry",
      source: "web_inquiry",
      sourceRefId: "inq-2",
      title: "Website inquiry from Cam Contact",
      summary: "Pricing question",
      buyerLabel: "Cam Contact",
      channelLabel: "Storefront inquiry",
      observedAtLabel: "25 May 2026",
      routingState: "linked",
      routingLabel: "Engagement exists",
      routingTone: "success",
      evidence: ["Ref INQ-1002"],
      contactLabel: "Cam Contact",
      accountLabel: "Beta Ops",
      linkedEngagement: {
        id: "eng-2",
        title: "Website inquiry from Cam Contact",
        statusLabel: "New",
      },
      routeAction: null,
      integrationHref: null,
      aiTopics: [],
    },
  ],
};

describe("AcquisitionSignalRouter", () => {
  it("distinguishes observed signals from linked engagements and renders the explicit route action", () => {
    const html = renderToStaticMarkup(
      <AcquisitionSignalRouter
        workspace={workspace}
        formAction={() => undefined}
      />,
    );

    expect(html).toContain("Acquisition signals");
    expect(html).toContain("2 observed");
    expect(html).toContain("1 ready");
    expect(html).toContain("Website inquiry from Bea Buyer");
    expect(html).toContain("Ready to create engagement");
    expect(html).toContain("Create engagement");
    expect(html).toContain('name="sourceRefId" value="inq-1"');
    expect(html).toContain("Engagement exists");
  });

  it("uses theme-aware classes rather than raw color values", () => {
    const html = renderToStaticMarkup(
      <AcquisitionSignalRouter
        workspace={workspace}
        formAction={() => undefined}
      />,
    );

    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).toContain("var(--dpf-");
  });
});
