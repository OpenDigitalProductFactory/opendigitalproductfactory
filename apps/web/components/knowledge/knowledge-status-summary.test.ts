import { describe, expect, it } from "vitest";
import { describeEmptyKnowledgeView, KNOWLEDGE_STATUS_TABS } from "./knowledge-status-summary";

describe("describeEmptyKnowledgeView (BI-65D87B87)", () => {
  it("invites a first article only when the knowledge base is truly empty", () => {
    const view = describeEmptyKnowledgeView("published", {});
    expect(view.title).toBe("No knowledge articles yet");
    expect(view.description).toMatch(/Create the first article/);
    expect(view.link).toBeNull();
  });

  it("points at waiting drafts instead of claiming the knowledge base is empty", () => {
    // Live install 2026-09-30: three drafts, nothing published.
    const view = describeEmptyKnowledgeView("published", { draft: 3 });
    expect(view.title).toBe("Nothing in Published");
    expect(view.description).toBe("3 drafts are waiting to be published.");
    expect(view.description).not.toMatch(/Create the first article/);
    expect(view.link).toEqual({ label: "View drafts", status: "draft" });
  });

  it("uses the singular for one draft", () => {
    expect(describeEmptyKnowledgeView("published", { draft: 1 }).description).toBe(
      "1 draft is waiting to be published.",
    );
  });

  it("leaves other empty tabs to the tab counts, with no invitation to start over", () => {
    const view = describeEmptyKnowledgeView("archived", { published: 2, draft: 1 });
    expect(view.title).toBe("Nothing in Archived");
    expect(view.description).toBeNull();
    expect(view.link).toBeNull();
  });
});

describe("KNOWLEDGE_STATUS_TABS", () => {
  it("keeps Published first so it stays the default view", () => {
    expect(KNOWLEDGE_STATUS_TABS.map((t) => t.value)).toEqual([
      "published",
      "draft",
      "review-needed",
      "archived",
    ]);
  });
});
