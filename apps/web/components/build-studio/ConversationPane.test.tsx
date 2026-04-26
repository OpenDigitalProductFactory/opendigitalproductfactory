// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationPane } from "./ConversationPane";
import { DEMO_CONVERSATION, DEMO_STEPS } from "@/lib/build-studio-demo";

describe("ConversationPane", () => {
  it("renders all eight demo messages and the composer", () => {
    render(
      <ConversationPane
        messages={DEMO_CONVERSATION}
        steps={DEMO_STEPS}
        userName="Maya"
        onSend={() => {}}
        onPause={() => {}}
        onSuggest={() => {}}
        onOpenArtifact={() => {}}
      />,
    );
    // Each message renders a snippet of its text.
    expect(
      screen.getByText(/We need a way for tenant owners to rotate/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Got it. Before I build/)).toBeInTheDocument();
    expect(
      screen.getByText(/60 seconds and owners only/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Done. I'll record who rotated/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Plan ready/)).toBeInTheDocument();
    expect(screen.getByText(/Code is written/)).toBeInTheDocument();
    expect(
      screen.getByText(/I'm walking through the feature in the browser/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I'm ready to ship this/),
    ).toBeInTheDocument();
    // Composer
    expect(screen.getByPlaceholderText(/reply to dpf/i)).toBeInTheDocument();
  });
});
