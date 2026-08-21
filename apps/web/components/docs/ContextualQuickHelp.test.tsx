// @vitest-environment jsdom
import "@/test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContextualQuickHelp } from "./ContextualQuickHelp";

describe("ContextualQuickHelp", () => {
  it("keeps the contextual provenance and a Back to page link to the source route", () => {
    render(<ContextualQuickHelp sourceRoute="/storefront/inbox" />);

    expect(screen.getByText("Contextual Docs")).toBeInTheDocument();
    expect(screen.getByText("/storefront/inbox")).toBeInTheDocument();

    const back = screen.getByRole("link", { name: "Back to page" });
    expect(back).toHaveAttribute("href", "/storefront/inbox");
  });

  it("renders a quick-help panel answering all five questions before the full doc body", () => {
    render(<ContextualQuickHelp sourceRoute="/ops/self-upgrade" />);

    expect(screen.getByText("Quick help")).toBeInTheDocument();
    for (const label of [
      "What this page is",
      "What to do now",
      "If you do nothing",
      "What's reversible",
      "Where to get help",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Self-upgrade guidance surfaces its rollback safety net and window discipline.
    expect(screen.getByText(/rolled back/i)).toBeInTheDocument();
    expect(screen.getByText(/deployment window/i)).toBeInTheDocument();
  });

  it("shows route-specific guidance for shared docs based on the source route", () => {
    const { unmount } = render(<ContextualQuickHelp sourceRoute="/storefront/settings/business" />);
    expect(screen.getByText(/business-context settings/i)).toBeInTheDocument();
    unmount();

    render(<ContextualQuickHelp sourceRoute="/customer/marketing" />);
    expect(screen.getByText(/customer acquisition/i)).toBeInTheDocument();
  });

  it("still shows the banner but omits the quick-help panel for routes without curated help", () => {
    render(<ContextualQuickHelp sourceRoute="/no-such-area/banking" />);

    expect(screen.getByRole("link", { name: "Back to page" })).toHaveAttribute("href", "/no-such-area/banking");
    expect(screen.queryByText("Quick help")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-internal source route", () => {
    const { container } = render(<ContextualQuickHelp sourceRoute="https://evil.example.com" />);
    expect(container).toBeEmptyDOMElement();
  });
});
