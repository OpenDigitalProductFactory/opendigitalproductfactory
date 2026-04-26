// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewFrame } from "./PreviewFrame";

describe("PreviewFrame", () => {
  it("renders the sandbox URL when provided", () => {
    render(<PreviewFrame sandboxUrl="sandbox.dpf.local/settings/api-keys" />);
    expect(screen.getByText(/sandbox.dpf.local/)).toBeInTheDocument();
    expect(screen.getByText(/live/i)).toBeInTheDocument();
  });

  it("renders the three mock API key rows from the bundle reference", () => {
    render(<PreviewFrame sandboxUrl="sandbox.dpf.local/settings/api-keys" />);
    expect(screen.getAllByTestId("preview-key-row")).toHaveLength(3);
    expect(screen.getByText(/grace window/i)).toBeInTheDocument();
  });

  it("renders an empty state when no sandbox URL is supplied", () => {
    render(<PreviewFrame sandboxUrl={null} />);
    expect(screen.getByText(/no sandbox running yet/i)).toBeInTheDocument();
  });
});
