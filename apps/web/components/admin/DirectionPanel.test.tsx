import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/organization-direction", () => ({ saveDirectionAction: vi.fn() }));

import { DirectionPanel } from "./DirectionPanel";

const EMPTY = { mission: "", vision: "", outcomes: [] };

function render(node: ReactElement) {
  return renderToStaticMarkup(
    <MessagesProvider locale="en-US" messages={{ storefront: namespaceMessages("en-US", "storefront") }}>{node}</MessagesProvider>,
  );
}

describe("DirectionPanel (BI-916216E7)", () => {
  it("starts empty and shows each missing part as not set yet (AC-1, AC-3)", () => {
    const html = render(<DirectionPanel initial={EMPTY} source="settings" entityNoun="business" />);
    expect(html).toContain("Your direction");
    expect(html).toContain("Why does your business exist?");
    expect(html).toContain("Where is your business heading?");
    expect(html).toContain("Top-level outcomes");
    expect((html.match(/Not set yet/g) ?? []).length).toBe(3);
    // Nothing pre-filled: the only textareas are empty.
    expect(html).not.toMatch(/<textarea[^>]*>[^<]+<\/textarea>/);
  });

  it("offers the mission starter as a button, never as a value", () => {
    const html = render(
      <DirectionPanel initial={EMPTY} source="setup" entityNoun="business" missionSuggestion="Serve our town well." />,
    );
    expect(html).toContain("Suggest a starter");
    expect(html).not.toMatch(/<textarea[^>]*name="mission"[^>]*>Serve our town well\./);
  });

  it("renders saved outcomes with their measures and no missing badge", () => {
    const html = render(
      <DirectionPanel
        initial={{
          mission: "M",
          vision: "V",
          outcomes: [{ id: "o1", statement: "Fewer asthma visits", measure: "ER visits drop" }],
        }}
        source="settings"
        entityNoun="business"
      />,
    );
    expect(html).toContain("Fewer asthma visits");
    expect(html).toContain("ER visits drop");
    expect(html).not.toContain("Not set yet");
    expect(html).toContain("Save direction");
  });

  it("keeps a nonprofit mission unanswered while offering an archetype-aware starter", () => {
    const html = render(
      <DirectionPanel
        initial={EMPTY}
        source="settings"
        entityNoun="organization"
        missionSuggestion="At Second Chance, we exist to give every animal time and care."
      />,
    );
    expect(html).toContain("Why does your organization exist?");
    expect(html).toContain("Suggest a starter");
    expect(html).toMatch(/name="mission"[^>]*>\s*<\/textarea>/);
    expect(html).not.toContain(">At Second Chance, we exist to give every animal time and care.</textarea>");
  });

  it("asks for one to three outcomes during setup", () => {
    const html = render(<DirectionPanel initial={EMPTY} source="setup" entityNoun="organization" />);
    expect(html).toMatch(/one to three/i);
    expect(html).toContain("Why does your organization exist?");
  });
});
