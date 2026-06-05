import { describe, expect, it } from "vitest";

import {
  classifyPerspective,
  extractPageTopic,
  buildPerspectiveQuery,
  buildPerspectiveHint,
  PERSPECTIVE_PAGE_KINDS,
} from "./perspective-intent";

describe("classifyPerspective", () => {
  it("detects WWMD from 'what does mark think'", () => {
    const c = classifyPerspective("what does mark think about this?");
    expect(c.perspective).toBe("wwmd");
    expect(c.needsPageContext).toBe(true);
  });

  it.each([
    "What would Mark do here?",
    "would mark approve this approach",
    "What is Mark's stance on monorepos?",
    "wwmd about pricing",
    "should I ask mark first",
  ])("detects WWMD: %s", (msg) => {
    expect(classifyPerspective(msg).perspective).toBe("wwmd");
  });

  it.each([
    "what should we do about churn?",
    "what would we think of this vendor",
    "should we ship on Friday?",
    "what's our position on refunds",
    "how should we handle this escalation",
    "wwwd here",
  ])("detects WWWD: %s", (msg) => {
    expect(classifyPerspective(msg).perspective).toBe("wwwd");
  });

  it("prefers WWMD when a message names Mark and uses 'we'", () => {
    // Named-person intent is more specific than the collective signal.
    const c = classifyPerspective("what would Mark say we should do?");
    expect(c.perspective).toBe("wwmd");
  });

  it("returns null for ordinary questions", () => {
    expect(classifyPerspective("summarize this backlog item").perspective).toBeNull();
    expect(classifyPerspective("create a new product").perspective).toBeNull();
  });

  it("flags needsPageContext only when a deictic pronoun is present", () => {
    expect(classifyPerspective("what does mark think about this").needsPageContext).toBe(true);
    expect(classifyPerspective("what does mark think about pricing strategy").needsPageContext).toBe(false);
  });

  it("does not throw on empty / nullish input", () => {
    expect(classifyPerspective("").perspective).toBeNull();
    // @ts-expect-error exercising defensive nullish handling
    expect(classifyPerspective(undefined).perspective).toBeNull();
  });
});

describe("PERSPECTIVE_PAGE_KINDS", () => {
  it("biases WWMD toward Mark's opinion corpus", () => {
    expect(PERSPECTIVE_PAGE_KINDS.wwmd).toContain("stance");
    expect(PERSPECTIVE_PAGE_KINDS.wwmd).toContain("heuristic");
  });

  it("includes principle pages for WWWD (collective doctrine)", () => {
    expect(PERSPECTIVE_PAGE_KINDS.wwwd).toContain("principle");
  });
});

describe("extractPageTopic", () => {
  it("takes the first meaningful line of page data, stripping markers", () => {
    const topic = extractPageTopic("--- PAGE DATA ---\nPricing strategy for SMB tier\nmore detail", "/platform/pricing");
    expect(topic).toBe("Pricing strategy for SMB tier");
  });

  it("strips leading list/heading markers", () => {
    expect(extractPageTopic("# Refund Policy\nbody", null)).toBe("Refund Policy");
    expect(extractPageTopic("- Vendor evaluation", null)).toBe("Vendor evaluation");
  });

  it("falls back to a humanised route segment", () => {
    expect(extractPageTopic(null, "/wiki/perspectives/mark-dpf-platform")).toBe("mark dpf platform");
    expect(extractPageTopic("   ", "/build/[buildId]?tab=plan")).toBe("buildId");
  });

  it("returns null when neither source yields anything", () => {
    expect(extractPageTopic(null, null)).toBeNull();
    expect(extractPageTopic("", "")).toBeNull();
  });

  it("caps very long topics", () => {
    const long = "x".repeat(300);
    expect(extractPageTopic(long, null)!.length).toBe(120);
  });
});

describe("buildPerspectiveQuery", () => {
  it("leads with the page topic when the message is deictic", () => {
    expect(buildPerspectiveQuery("what does mark think about this?", "Pricing strategy")).toBe(
      "Pricing strategy. what does mark think about this?",
    );
  });

  it("leaves the message unchanged when there is no deictic pronoun", () => {
    expect(buildPerspectiveQuery("what does mark think about pricing", "Pricing strategy")).toBe(
      "what does mark think about pricing",
    );
  });

  it("leaves the message unchanged when there is no page topic", () => {
    expect(buildPerspectiveQuery("what does mark think about this", null)).toBe(
      "what does mark think about this",
    );
  });
});

describe("buildPerspectiveHint", () => {
  it("WWMD hint attributes to Mark and forbids invention", () => {
    const hint = buildPerspectiveHint("wwmd", "Pricing strategy");
    expect(hint).toContain("WHAT WOULD MARK DO");
    expect(hint).toContain("Mark's position is");
    expect(hint).toContain("Pricing strategy");
    expect(hint.toLowerCase()).toContain("never invent");
  });

  it("WWWD hint frames a collective decision and flags the seeded-doctrine caveat", () => {
    const hint = buildPerspectiveHint("wwwd", null);
    expect(hint).toContain("WHAT WOULD WE DO");
    expect(hint).toContain("collective");
    expect(hint).toContain("seeded from the platform doctrine");
  });
});
