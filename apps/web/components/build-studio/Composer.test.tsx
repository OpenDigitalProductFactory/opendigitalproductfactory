// @vitest-environment jsdom
import "./test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

describe("Composer", () => {
  it("disables Send when textarea is empty", () => {
    render(<Composer onSend={() => {}} onPause={() => {}} onSuggest={() => {}} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("calls onSend with the typed text on Cmd+Enter", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} onPause={() => {}} onSuggest={() => {}} />);
    const ta = screen.getByPlaceholderText(/reply to dpf/i);
    fireEvent.change(ta, { target: { value: "ship it" } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("ship it");
  });

  it("clears the textarea after Send is clicked", () => {
    render(<Composer onSend={() => {}} onPause={() => {}} onSuggest={() => {}} />);
    const ta = screen.getByPlaceholderText(/reply to dpf/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(ta.value).toBe("");
  });
});
