// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DialogHost, confirmDialog, alertDialog, promptDialog } from "./Dialog";

/**
 * BI-B0E4F3F1 — these tests encode the automation contract that the whole
 * change exists for: a confirm/alert/prompt flow must be completable by finding
 * a button via a STABLE DOM ref (`data-dialog-action`) and clicking it, with the
 * imperative promise resolving from that DOM interaction. A native
 * window.confirm could never pass this test — that is the point.
 */

afterEach(cleanup);

function clickAction(action: "confirm" | "cancel") {
  const btn = document.querySelector<HTMLButtonElement>(`[data-dialog-action="${action}"]`);
  if (!btn) throw new Error(`no [data-dialog-action="${action}"] in DOM`);
  fireEvent.click(btn);
}

describe("in-app Dialog primitive", () => {
  it("confirmDialog resolves true when the confirm ref is clicked", async () => {
    render(<DialogHost />);
    let resolved: boolean | undefined;
    act(() => {
      void confirmDialog({ title: "Delete build", message: "Delete it?" }).then((v) => {
        resolved = v;
      });
    });
    await screen.findByText("Delete build");
    act(() => clickAction("confirm"));
    await waitFor(() => expect(resolved).toBe(true));
    // Dialog is dismissed after resolution.
    expect(document.querySelector("[data-dpf-dialog]")).toBeNull();
  });

  it("confirmDialog resolves false when the cancel ref is clicked", async () => {
    render(<DialogHost />);
    let resolved: boolean | undefined;
    act(() => {
      void confirmDialog("Sure?").then((v) => {
        resolved = v;
      });
    });
    await waitFor(() => expect(document.querySelector('[data-dialog-action="cancel"]')).not.toBeNull());
    act(() => clickAction("cancel"));
    await waitFor(() => expect(resolved).toBe(false));
  });

  it("promptDialog returns the typed value via the input ref + confirm ref", async () => {
    render(<DialogHost />);
    let result: string | null | undefined;
    act(() => {
      void promptDialog({ title: "Rejection reason", required: true }).then((v) => {
        result = v;
      });
    });
    await screen.findByText("Rejection reason");
    const input = document.querySelector<HTMLInputElement>("[data-dialog-input]");
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.change(input!, { target: { value: "incomplete hours" } });
    });
    act(() => clickAction("confirm"));
    await waitFor(() => expect(result).toBe("incomplete hours"));
  });

  it("promptDialog confirm stays disabled while a required field is empty", async () => {
    render(<DialogHost />);
    act(() => {
      void promptDialog({ title: "Reason", required: true });
    });
    await screen.findByText("Reason");
    const confirm = document.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]');
    expect(confirm?.disabled).toBe(true);
  });

  it("alertDialog shows a single dismiss ref and no cancel", async () => {
    render(<DialogHost />);
    let done = false;
    act(() => {
      void alertDialog("PDF generation failed.").then(() => {
        done = true;
      });
    });
    await screen.findByText("PDF generation failed.");
    expect(document.querySelector('[data-dialog-action="cancel"]')).toBeNull();
    act(() => clickAction("confirm"));
    await waitFor(() => expect(done).toBe(true));
  });

  it("renders accessible dialog semantics", async () => {
    render(<DialogHost />);
    act(() => {
      void confirmDialog({ title: "Confirm thing", message: "body" });
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });
});
