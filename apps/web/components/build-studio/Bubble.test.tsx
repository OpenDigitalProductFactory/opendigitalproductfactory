// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bubble } from "./Bubble";

describe("Bubble", () => {
  it("renders assistant role with persona and 'your build assistant' caption", () => {
    render(
      <Bubble
        msg={{ role: "assistant", time: "9:18am", text: "hi" }}
        steps={[]}
        onOpenArtifact={() => {}}
      />,
    );
    expect(screen.getByText("DPF")).toBeInTheDocument();
    expect(screen.getByText(/your build assistant/i)).toBeInTheDocument();
    expect(screen.getByText("9:18am")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("renders user role with first-letter avatar and no assistant caption", () => {
    render(
      <Bubble
        msg={{ role: "user", time: "9:14am", text: "ship it" }}
        steps={[]}
        onOpenArtifact={() => {}}
        userName="Maya"
      />,
    );
    expect(screen.queryByText(/build assistant/i)).not.toBeInTheDocument();
    expect(screen.getByText("Maya")).toBeInTheDocument();
  });

  it("flags needs-action via data attribute when msg.needsAction is true", () => {
    const { container } = render(
      <Bubble
        msg={{ role: "assistant", time: "now", text: "x", needsAction: true }}
        steps={[]}
        onOpenArtifact={() => {}}
      />,
    );
    expect(container.firstChild).toHaveAttribute("data-needs-action", "true");
  });

  it("does NOT flag needs-action when msg.needsAction is absent", () => {
    const { container } = render(
      <Bubble
        msg={{ role: "assistant", time: "now", text: "x" }}
        steps={[]}
        onOpenArtifact={() => {}}
      />,
    );
    expect(container.firstChild).not.toHaveAttribute("data-needs-action", "true");
  });
});
